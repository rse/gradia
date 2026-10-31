/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Edge }                        from "./gradia-api-model.js"
import { Config }                            from "./gradia-api-config.js"
import { pushTo }                            from "./gradia-api-type-graph-place.js"
import { RoutePlan, CHAN_W0, CHAN_W1, GUT_H0, GUT_H1, GUT_PAD, GUT_LBL, LOOP_TOP }
    from "./gradia-api-type-graph-plan.js"

/*  the computed grid geometry: the sizes of the columns and rows, the
    widths of the inter-column channels, the heights of the inter-row
    gutters (both as capped by their configured maximum, within which
    their tracks are spread, and as finally sized), the resulting
    column/row/gutter center positions, and, for packed columns, the
    node center positions and shift ranges (see packColumns)  */
export interface Grid {
    colWidth:  number[]
    rowHeight: number[]
    chanCap:   number[]
    gutCap:    number[]
    chanW:     number[]
    gutH:      number[]
    colCX:     number[]
    rowCY:     number[]
    gutCY:     number[]
    nodeCY?:   Map<string, number>
    room?:     Map<string, [ number, number ]>
}

/*  the widths of the crowded channels and the heights of the crowded
    gutters needed by their bundled tracks  */
export interface Need {
    chan: Map<number, number>
    gut:  Map<number, number>
}

/*  the uniform layout of an explicitly ordered graph in lanes (e.g. the
    layers of a "layer" diagram): all boxes take one width, the boxes of a
    lane one height, and all gutters one height, while the marked edges
    never share a bundle with unmarked ones (a transposed one turns the
    order values into columns instead of rows, e.g. for the slices of a
    "slice" diagram)  */
export interface Uniform {
    laneOf:      (id: string) => number
    markOf?:     (edge: Edge) => boolean
    transposed?: boolean
}

/*  the height the detours of the given number of self-loops of a node
    rise above its box (e.g. for a lane to enclose them)  */
export const loopRise = (count: number, config: Config): number =>
    count > 0 ? LOOP_TOP + (count - 1) * config["size-edge-track-gap"] : 0

/*  determine grid cell sizes and final node center positions, with
    channel widths and gutter heights sized by actual edge usage to
    keep the overall layout compact (or, for a uniform layout, all
    gutters at the height of the highest one), except the crowded ones,
    which are sized by the needs of their bundled tracks  */
export const computeGrid = (
    nodes:   Node[],
    col:     Map<string, number>,
    row:     Map<string, number>,
    boxW:    Map<string, number>,
    boxH:    Map<string, number>,
    ncols:   number,
    nrows:   number,
    chanCnt: Map<number, number>,
    gutCnt:  Map<number, number>,
    chanLbl: Map<number, number>,
    gutLbl:  Map<number, number>,
    gutLoop: Map<number, number>,
    even:    boolean,
    need:    Need,
    config:  Config
): Grid => {
    const colWidth  = Array.from({ length: ncols }, () => 0)
    const rowHeight = Array.from({ length: nrows }, () => 0)
    for (const node of nodes) {
        colWidth[col.get(node.id)!]  = Math.max(colWidth[col.get(node.id)!],  boxW.get(node.id)!)
        rowHeight[row.get(node.id)!] = Math.max(rowHeight[row.get(node.id)!], boxH.get(node.id)!)
    }

    /*  size the channels and gutters by their actual edge usage, grown
        to hold the edge labels landing inside (a channel by its widest
        label demand, a gutter by one line per label) and the self-loop
        detours rising into a gutter from the row below, and floored by
        the configured minimum width/height  */
    const chanOf  = (c: number, tracks: number) =>
        Math.min(config["graph-channel-width-max"],
            Math.max(config["graph-channel-width-min"], tracks, chanLbl.get(c) ?? 0))
    const gutOf   = (g: number, tracks: number) => {
        const lbl  = gutLbl.get(g)  ?? 0
        const loop = gutLoop.get(g) ?? 0
        return Math.min(config["graph-gutter-height-max"],
            Math.max(config["graph-gutter-height-min"], tracks,
                lbl  > 0 ? GUT_H1 + lbl * GUT_LBL : 0,
                loop > 0 ? loopRise(loop, config) + GUT_PAD : 0))
    }
    const chanCap = Array.from({ length: ncols }, (_, c) => {
        const cnt = chanCnt.get(c) ?? 0
        return chanOf(c, cnt === 0 ? CHAN_W0 : CHAN_W1 + (cnt - 1) * config["size-edge-track-gap"])
    })
    const gutCap  = Array.from({ length: nrows }, (_, g) => {
        const cnt = gutCnt.get(g) ?? 0
        return gutOf(g, cnt === 0 ? GUT_H0 : GUT_H1 + (cnt - 1) * config["size-edge-track-gap"])
    })
    if (even)
        gutCap.fill(Math.max(0, ...gutCap))

    /*  size the crowded channels and gutters by the needs of their
        bundled tracks instead of by their edge count, still holding
        their labels and loops (for a uniform layout again all gutters alike)  */
    const chanW = chanCap.map((w, c) => need.chan.has(c) ? Math.max(need.chan.get(c)!, chanOf(c, 0)) : w)
    const gutH  = gutCap.map((h, g)  => need.gut.has(g)  ? Math.max(need.gut.get(g)!,  gutOf(g, 0))  : h)
    if (even && need.gut.size > 0)
        gutH.fill(Math.max(0, ...gutH))

    /*  derive the column and row center positions  */
    const colCX: number[] = []
    const rowCY: number[] = []
    let x = config["size-canvas-margin"]
    for (let c = 0; c < colWidth.length; c++) {
        colCX.push(x + colWidth[c] / 2)
        x += colWidth[c] + chanW[c]
    }
    let y = config["size-canvas-margin"]
    for (let r = 0; r < rowHeight.length; r++) {
        rowCY.push(y + rowHeight[r] / 2)
        y += rowHeight[r] + gutH[r]
    }
    const gutCY = rowCY.map((cy, g) => cy + rowHeight[g] / 2 + gutH[g] / 2)
    return { colWidth, rowHeight, chanCap, gutCap, chanW, gutH, colCX, rowCY, gutCY }
}

/*  pack the columns of the grid vertically: instead of centering every
    node in a row as high as its highest box, every column stacks its
    nodes in their row order, spaced like an edge-less gutter. Only the
    nodes linked by a direct same-row edge share a center line, and a
    used gutter becomes a band across the lanes its tracks cross, below
    the rows above it there and below the upper end nodes of its edges.
    A reverse sweep lets the boxes whose edges all lead downwards sink
    back towards their neighbors, and the free room around every box
    becomes its shift range for the node nudging  */
export const packColumns = (
    grid:   Grid,
    nodes:  Node[],
    edges:  Edge[],
    plans:  RoutePlan[],
    col:    Map<string, number>,
    row:    Map<string, number>,
    boxH:   Map<string, number>,
    nrows:  number,
    config: Config
): Grid => {
    const margin = config["size-canvas-margin"]
    const space  = Math.min(config["graph-gutter-height-max"],
        Math.max(config["graph-gutter-height-min"], GUT_H0))

    /*  the lanes: the column c is lane 2c, the channel right of it lane 2c+1  */
    const laneOf = (id: string) => 2 * col.get(id)!

    /*  group the nodes linked by direct same-row edges, as they share one center line  */
    const groupOf = new Map<string, string>()
    const find    = (id: string): string => {
        let root = id
        while (groupOf.has(root))
            root = groupOf.get(root)!
        return root
    }
    edges.forEach((edge, i) => {
        if (edge.source === edge.target || plans[i].chans.length !== 1 || plans[i].flags[0].hairpin
            || row.get(edge.source) !== row.get(edge.target))
            return
        const [ a, b ] = [ find(edge.source), find(edge.target) ]
        if (a !== b)
            groupOf.set(b, a)
    })
    const byRow = Array.from({ length: nrows }, () => new Map<string, Node[]>())
    for (const node of nodes)
        pushTo(byRow[row.get(node.id)!], find(node.id), node)

    /*  the room above every box: of its self-loop detours  */
    const loopCnt = new Map<string, number>()
    for (const edge of edges)
        if (edge.source === edge.target)
            loopCnt.set(edge.source, (loopCnt.get(edge.source) ?? 0) + 1)
    const headRoom = (id: string) => {
        const cnt = loopCnt.get(id) ?? 0
        return cnt > 0 ? loopRise(cnt, config) + GUT_PAD : 0
    }

    /*  the lane span of every used gutter (from the channel of one end to
        the channel of the other end, or up to the gate a gutter-ending
        edge ends at) and the end nodes of its edges  */
    const span = new Map<number, [ number, number ]>()
    const ends = new Map<number, string[]>()
    edges.forEach((edge, i) => {
        const { chans, guts, gate } = plans[i]
        if (guts.length === 0)
            return
        const g = guts[0]
        const a = gate === "s" ? laneOf(edge.source) : 2 * chans[0] + 1
        const b = gate === "t" ? laneOf(edge.target) : 2 * chans[1] + 1
        const [ lo, hi ] = span.get(g) ?? [ Infinity, -Infinity ]
        span.set(g, [ Math.min(lo, a, b), Math.max(hi, a, b) ])
        if (gate !== "s")
            pushTo(ends, g, edge.source)
        if (gate !== "t")
            pushTo(ends, g, edge.target)
    })

    /*  stack every node right below its lane so far (spaced like an
        edge-less gutter below a box, not below a band), and record the
        boxes and bands of every lane  */
    const bottom = new Map<number, number>()
    const seq    = new Map<number, (string | number)[]>()
    const nodeCY = new Map<string, number>()
    const gutCY  = grid.gutCY.slice()
    const gutTop = (g: number) => gutCY[g] - grid.gutH[g] / 2
    const top    = (id: string) => nodeCY.get(id)! - boxH.get(id)! / 2 - headRoom(id)
    const base   = (id: string) => nodeCY.get(id)! + boxH.get(id)! / 2
    const ceil   = new Map<string, number>()
    for (let r = 0; r < nrows; r++) {
        for (const members of byRow[r].values()) {
            /*  center the group on the lowest center line any member needs  */
            const cy = Math.max(...members.map((node) => {
                const lane = laneOf(node.id)
                const prev = seq.get(lane)?.at(-1)
                const free = prev === undefined ? margin : bottom.get(lane)! + (typeof prev === "string" ? space : 0)
                return free + headRoom(node.id) + boxH.get(node.id)! / 2
            }))
            for (const node of members) {
                nodeCY.set(node.id, cy)
                bottom.set(laneOf(node.id), base(node.id))
                pushTo(seq, laneOf(node.id), node.id)
            }
        }

        /*  place the band of the gutter below the row, if used  */
        const lanes = span.get(r)
        if (lanes === undefined)
            continue
        const above = (ends.get(r) ?? []).filter((id) => row.get(id)! <= r)
        let y = margin
        for (let lane = lanes[0]; lane <= lanes[1]; lane++)
            y = Math.max(y, bottom.get(lane) ?? margin)
        for (const id of above)
            y = Math.max(y, base(id))
        gutCY[r] = y + grid.gutH[r] / 2
        for (let lane = lanes[0]; lane <= lanes[1]; lane++) {
            bottom.set(lane, y + grid.gutH[r])
            pushTo(seq, lane, r)
        }
        for (const id of above)
            ceil.set(id, Math.min(ceil.get(id) ?? Infinity, y))
    }
    const lowest = Math.max(margin, ...Array.from(bottom.values()))

    /*  the box or band right above and below every box in its lane  */
    const prevOf = new Map<string, string | number>()
    const nextOf = new Map<string, string | number>()
    for (const items of seq.values())
        items.forEach((item, i) => {
            if (typeof item !== "string")
                return
            if (i > 0)
                prevOf.set(item, items[i - 1])
            if (i + 1 < items.length)
                nextOf.set(item, items[i + 1])
        })

    /*  let every box not sharing a center line, whose edges all lead
        downwards, sink towards its nearest neighbor, as far as its lane
        and bands leave room  */
    const adjacent = new Map<string, string[]>()
    for (const edge of edges) {
        if (edge.source === edge.target)
            continue
        pushTo(adjacent, edge.source, edge.target)
        pushTo(adjacent, edge.target, edge.source)
    }
    for (let r = nrows - 1; r >= 0; r--) {
        for (const members of byRow[r].values()) {
            const id = members[0].id
            const nb = adjacent.get(id) ?? []
            if (members.length > 1 || nb.length === 0 || nb.some((other) => nodeCY.get(other)! <= nodeCY.get(id)!))
                continue
            const next  = nextOf.get(id)
            const limit = Math.min(ceil.get(id) ?? Infinity,
                next === undefined ? lowest : typeof next === "string" ? top(next) - space : gutTop(next))
            const want  = Math.min(...nb.map((other) => nodeCY.get(other)!)) - nodeCY.get(id)!
            nodeCY.set(id, nodeCY.get(id)! + Math.max(0, Math.min(want, limit - base(id))))
        }
    }

    /*  the shift range of every box: the free room up and down to the
        bands, and half the free room to the boxes, keeping the spacing  */
    const room = new Map<string, [ number, number ]>()
    for (const node of nodes) {
        const [ prev, next ] = [ prevOf.get(node.id), nextOf.get(node.id) ]
        const up   = prev === undefined ? top(node.id) - margin :
            typeof prev === "string" ? (top(node.id) - base(prev) - space) / 2 :
                top(node.id) - gutTop(prev) - grid.gutH[prev]
        const down = next === undefined ? lowest - base(node.id) :
            typeof next === "string" ? (top(next) - base(node.id) - space) / 2 :
                gutTop(next) - base(node.id)
        room.set(node.id, [ -Math.max(0, up), Math.max(0, down) ])
    }
    return { ...grid, gutCY, nodeCY, room }
}

