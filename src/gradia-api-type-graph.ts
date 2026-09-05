/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  external dependencies  */
import { DagreLayout } from "@antv/layout"

/*  internal dependencies  */
import { Graph, Node, Edge }                 from "./gradia-api-model.js"
import { Config }                            from "./gradia-api-config.js"
import { Poly, FS_EDGE, FS_ARITY, ARITY_OFF, textWidth, Layout }
    from "./gradia-api-render-base.js"
import { measureNodes }                      from "./gradia-api-render-node.js"
import { LevelContext, GateSide }            from "./gradia-api-render-container.js"
import { Side, TrackUser, simplifyPoly, assignPorts, assignTracks, computeHops }
    from "./gradia-api-render-edge.js"

/*  rendering geometry constants  */
const CLUSTX   = 26  /*  max X distance within a grid column         */
const CLUSTY   = 72  /*  max Y distance within a grid row            */
const CHAN_W0  = 24  /*  width of an edge-less inter-column channel  */
const CHAN_W1  = 28  /*  width of a one-edge inter-column channel    */
const CHAN_PAD = 16  /*  cross-axis padding inside a channel         */
const CHAN_LBL = 8   /*  padding beside an edge label in a channel   */
const GUT_H0   = 20  /*  height of an edge-less inter-row gutter     */
const GUT_H1   = 24  /*  height of a one-edge inter-row gutter       */
const GUT_PAD  = 12  /*  cross-axis padding inside a gutter          */
const GUT_LBL  = 22  /*  clearance above/below a label in a gutter   */
const LOOP_GAP = 24  /*  detour of a self-loop beside its node box   */
const LOOP_TOP = 52  /*  detour of a self-loop above its node box    */

/*  node nudging constants  */
const NUDGE_GAP    = 24  /*  min port distance of a nudged node from its gutter tracks  */
const NUDGE_PASSES = 3   /*  max number of node nudging passes                          */

/*  snap raw node positions onto a discrete grid by clustering the
    distinct X coordinates into columns and Y coordinates into rows  */
const snapToGrid = (
    nodes: Node[],
    rawX:  Map<string, number>,
    rawY:  Map<string, number>
): { col: Map<string, number>, row: Map<string, number>, ncols: number, nrows: number } => {
    const cluster = (values: number[], threshold: number): number[] => {
        const sorted = Array.from(new Set(values)).sort((a, b) => a - b)
        const reps: number[] = []
        for (const v of sorted)
            if (reps.length === 0 || v - reps[reps.length - 1] > threshold)
                reps.push(v)
        return reps
    }
    const colReps = cluster(nodes.map((node) => rawX.get(node.id)!), CLUSTX)
    const rowReps = cluster(nodes.map((node) => rawY.get(node.id)!), CLUSTY)
    const nearestIndexOf = (reps: number[], v: number): number => {
        let best = 0
        for (let i = 1; i < reps.length; i++)
            if (Math.abs(reps[i] - v) < Math.abs(reps[best] - v))
                best = i
        return best
    }

    /*  assign every node to its nearest column and row  */
    const col = new Map<string, number>()
    const row = new Map<string, number>()
    for (const node of nodes)
        col.set(node.id, nearestIndexOf(colReps, rawX.get(node.id)!))

    /*  split every row in which two nodes of one and the same column
        collide (the global clustering drops the row between two
        same-column nodes whenever both lie within the threshold of the
        rows around them): the raw position of the colliding node off
        its row becomes a row of its own, until all cells are unique  */
    for (;;) {
        for (const node of nodes)
            row.set(node.id, nearestIndexOf(rowReps, rawY.get(node.id)!))
        const cells = new Map<string, Node>()
        let   split: number | undefined
        for (const node of nodes) {
            const cell  = `${col.get(node.id)}:${row.get(node.id)}`
            const other = cells.get(cell)
            if (other === undefined) {
                cells.set(cell, node)
                continue
            }
            const rep = rowReps[row.get(node.id)!]
            split = Math.abs(rawY.get(node.id)! - rep) > Math.abs(rawY.get(other.id)! - rep) ?
                rawY.get(node.id)! : rawY.get(other.id)!
            break
        }
        if (split === undefined)
            break
        rowReps.push(split)
        rowReps.sort((a, b) => a - b)
    }
    return { col, row, ncols: colReps.length, nrows: rowReps.length }
}

/*  append a value to the array stored under a key of a multi-map  */
const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
    const list = map.get(key)
    if (list === undefined)
        map.set(key, [ value ])
    else
        list.push(value)
}

/*  refine the row assignment: the raw Dagre ordering tends to fling
    low-degree nodes far away from their neighbors, so pull every
    node vertically toward the median row of its direct neighbors,
    as far as free grid cells permit. The pull is deliberately gentle
    to not compress the rows too aggressively: distant nodes are
    pulled only half the way, and single-row moves are performed
    only when they align the node with a direct neighbor in an
    adjacent column (thereby straightening that edge)  */
const refineRows = (
    nodes: Node[],
    edges: Edge[],
    col:   Map<string, number>,
    row:   Map<string, number>
): void => {
    const cells = new Set<string>()
    for (const node of nodes)
        cells.add(`${col.get(node.id)}:${row.get(node.id)}`)
    const neighborsOf = new Map<string, string[]>()
    for (const edge of edges) {
        if (edge.source === edge.target)
            continue
        pushTo(neighborsOf, edge.source, edge.target)
        pushTo(neighborsOf, edge.target, edge.source)
    }

    /*  pull every node toward the median row of its neighbors  */
    for (const node of nodes) {
        const nb = neighborsOf.get(node.id)
        if (nb === undefined)
            continue
        const rows    = nb.map((id) => row.get(id)!).sort((a, b) => a - b)
        const desired = rows[Math.floor((rows.length - 1) / 2)]
        const cur     = row.get(node.id)!
        const dist    = Math.abs(desired - cur)
        if (dist === 0)
            continue
        const dir = Math.sign(desired - cur)
        let target: number
        if (dist === 1) {
            const aligns = nb.some((id) => row.get(id) === desired
                && Math.abs(col.get(id)! - col.get(node.id)!) === 1)
            if (!aligns)
                continue
            target = desired
        }
        else
            target = cur + dir * Math.ceil(dist / 2)
        for (let r = target; r !== cur; r -= dir) {
            if (!cells.has(`${col.get(node.id)}:${r}`)) {
                cells.delete(`${col.get(node.id)}:${cur}`)
                cells.add(`${col.get(node.id)}:${r}`)
                row.set(node.id, r)
                break
            }
        }
    }
}

/*  compact the rows of the grid, as the layered layout and the column
    folding leave many sparsely occupied rows behind: first lift every
    edge-less node (bound by no ordering constraint at all) into the
    topmost free cell of its column, then merge every row into the row
    above it as long as no column is occupied in both (which keeps the
    vertical order of all nodes and the row alignment of the nodes
    sharing a row), and finally renumber the rows densely  */
const compactRows = (
    nodes: Node[],
    edges: Edge[],
    col:   Map<string, number>,
    row:   Map<string, number>
): number => {
    const cells = new Set<string>()
    for (const node of nodes)
        cells.add(`${col.get(node.id)}:${row.get(node.id)}`)

    /*  lift every edge-less node into the topmost free cell of its column  */
    const linked = new Set<string>()
    for (const edge of edges) {
        linked.add(edge.source)
        linked.add(edge.target)
    }
    const isolated = nodes.filter((node) => !linked.has(node.id))
        .sort((a, b) => row.get(a.id)! - row.get(b.id)!)
    for (const node of isolated) {
        const c = col.get(node.id)!
        for (let r = 0; r < row.get(node.id)!; r++)
            if (!cells.has(`${c}:${r}`)) {
                cells.delete(`${c}:${row.get(node.id)}`)
                cells.add(`${c}:${r}`)
                row.set(node.id, r)
                break
            }
    }

    /*  merge every row into the row above it as long as no column is
        occupied in both, then renumber the rows densely  */
    const byRow = new Map<number, Node[]>()
    for (const node of nodes)
        pushTo(byRow, row.get(node.id)!, node)
    const rowMax   = Math.max(...byRow.keys())
    const rowIdx   = new Map<number, number>()
    let   idx      = -1
    let   occupied = new Set<number>()
    for (let r = 0; r <= rowMax; r++) {
        const members = byRow.get(r) ?? []
        if (idx < 0 || members.some((node) => occupied.has(col.get(node.id)!))) {
            idx++
            occupied = new Set<number>()
        }
        for (const node of members)
            occupied.add(col.get(node.id)!)
        rowIdx.set(r, idx)
    }
    for (const node of nodes)
        row.set(node.id, rowIdx.get(row.get(node.id)!)!)
    return idx + 1
}

/*  place the gate nodes of a containment level: the "in" gates into an
    additional first column and the "out" gates into an additional last
    column (both reserved for the gates, so the stubs from the container
    border to the gates never cross a node box), each gate into the row
    of the node its edge connects to, else into the nearest free row of
    the gate column, else into a row newly inserted below the wanted one  */
const placeGates = (
    gates: Map<string, GateSide>,
    edges: Edge[],
    col:   Map<string, number>,
    row:   Map<string, number>,
    ncols: number,
    nrows: number
): { ncols: number, nrows: number } => {
    const ins  = Array.from(gates).filter(([ , side ]) => side === "in").map(([ id ]) => id)
    const outs = Array.from(gates).filter(([ , side ]) => side === "out").map(([ id ]) => id)
    if (ins.length > 0) {
        for (const id of col.keys())
            col.set(id, col.get(id)! + 1)
        ncols++
    }
    if (outs.length > 0)
        ncols++
    const place = (ids: string[], c: number): void => {
        /*  the gates are placed in the order of their wanted rows, so
            the ones displaced into other rows never cross each other
            (the wanted row is the current row of the connected node,
            re-read per gate, as an inserted row shifts the nodes below)  */
        const otherOf = new Map<string, string>()
        for (const id of ids) {
            const edge = edges.find((edge) => edge.source === id || edge.target === id)!
            otherOf.set(id, edge.source === id ? edge.target : edge.source)
        }
        const wantOf = (id: string): number => row.get(otherOf.get(id)!)!
        ids.sort((a, b) => wantOf(a) - wantOf(b))
        const placed: string[] = []
        for (const id of ids) {
            const want  = wantOf(id)
            const taken = (r: number): boolean =>
                placed.some((other) => row.get(other) === r)
            let r: number | undefined
            for (let d = 0; r === undefined && d < nrows; d++) {
                if (want + d < nrows && !taken(want + d))
                    r = want + d
                else if (want - d >= 0 && !taken(want - d))
                    r = want - d
            }
            if (r === undefined) {
                for (const [ other, otherRow ] of row)
                    if (otherRow > want)
                        row.set(other, otherRow + 1)
                nrows++
                r = want + 1
            }
            col.set(id, c)
            row.set(id, r)
            placed.push(id)
        }
    }
    place(ins, 0)
    place(outs, ncols - 1)
    return { ncols, nrows }
}

/*  the coarse route of an edge: the inter-column channels and the
    inter-row gutters it occupies, and per channel the way it passes
    through it (mirrored: entering from the right side, hairpin:
    leaving on the very side it entered from)  */
interface RoutePlan {
    chans: number[]
    guts:  number[]
    flags: { mirror: boolean, hairpin: boolean }[]
}

/*  plan the coarse route of every edge: which inter-column channels
    and inter-row gutters it occupies (based on the grid indices and
    the attachment sides only): the source stub reaches the channel
    beside its attachment side, the target stub the channel beside
    its one, and, if those differ, the gutter next to the target row
    connects them  */
const planRoutes = (
    edges: Edge[],
    col:   Map<string, number>,
    row:   Map<string, number>,
    sides: { s: Side, t: Side }[]
): { plans: RoutePlan[], chanCnt: Map<number, number>, gutCnt: Map<number, number>,
    chanLbl: Map<number, number>, gutLbl: Map<number, number> } => {
    const flag = (from: "l" | "r", to: "l" | "r") =>
        ({ mirror: from === "r", hairpin: from === to })
    const plans = edges.map((edge, i): RoutePlan => {
        /*  a self-loop is routed around its own node box and uses no channel  */
        if (edge.source === edge.target)
            return { chans: [], guts: [], flags: [] }
        const sc = col.get(edge.source)!
        const tc = col.get(edge.target)!
        const sr = row.get(edge.source)!
        const tr = row.get(edge.target)!
        const sChan = sides[i].s === "e" ? sc : sc - 1
        const tChan = sides[i].t === "w" ? tc - 1 : tc
        const sFrom = sides[i].s === "e" ? "l" : "r"
        const tTo   = sides[i].t === "w" ? "r" : "l"
        if (sChan === tChan)
            return { chans: [ sChan ], guts: [], flags: [ flag(sFrom, tTo) ] }
        const dir = tChan > sChan ? "r" : "l"
        return {
            chans: [ sChan, tChan ],
            guts:  [ tr > sr ? tr - 1 : tr ],
            flags: [ flag(sFrom, dir), flag(dir === "r" ? "l" : "r", tTo) ]
        }
    })

    /*  count the edges occupying each channel and gutter and determine
        the room the edge labels need there: a name is placed in the
        single channel of its edge, or, for a two-channel edge, along
        its gutter run, costing one label line there; an arity is always
        placed in the channel through which its edge finally approaches
        the target node, set back from the arrow head  */
    const chanCnt  = new Map<number, number>()
    const gutCnt   = new Map<number, number>()
    const chanLbl  = new Map<number, number>()
    const gutLbl   = new Map<number, number>()
    const chanNeed = (c: number, width: number) =>
        chanLbl.set(c, Math.max(chanLbl.get(c) ?? 0, width))
    plans.forEach((plan, i) => {
        for (const c of plan.chans)
            chanCnt.set(c, (chanCnt.get(c) ?? 0) + 1)
        for (const g of plan.guts)
            gutCnt.set(g, (gutCnt.get(g) ?? 0) + 1)
        const { name, arity } = edges[i]
        if (name !== undefined && plan.chans.length === 1)
            chanNeed(plan.chans[0], textWidth(name, FS_EDGE) + 2 * CHAN_LBL)
        else if (name !== undefined && plan.guts.length > 0)
            gutLbl.set(plan.guts[0], (gutLbl.get(plan.guts[0]) ?? 0) + 1)
        if (arity !== undefined && plan.chans.length > 0)
            chanNeed(plan.chans[plan.chans.length - 1],
                ARITY_OFF + textWidth(arity, FS_ARITY) + CHAN_LBL)
    })
    return { plans, chanCnt, gutCnt, chanLbl, gutLbl }
}

/*  the computed grid geometry: the sizes of the columns and rows, the
    widths of the inter-column channels, the heights of the inter-row
    gutters, and the resulting column/row center positions  */
interface Grid {
    colWidth:  number[]
    rowHeight: number[]
    chanW:     number[]
    gutH:      number[]
    colCX:     number[]
    rowCY:     number[]
}

/*  determine grid cell sizes and final node center positions, with
    channel widths and gutter heights sized by actual edge usage to
    keep the overall layout compact  */
const computeGrid = (
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
    config:  Config
): Grid => {
    const colWidth  = Array.from({ length: ncols }, () => 0)
    const rowHeight = Array.from({ length: nrows }, () => 0)
    for (const node of nodes) {
        colWidth[col.get(node.id)!]   = Math.max(colWidth[col.get(node.id)!],   boxW.get(node.id)!)
        rowHeight[row.get(node.id)!]  = Math.max(rowHeight[row.get(node.id)!],  boxH.get(node.id)!)
    }

    /*  size the channels and gutters by their actual edge usage, each
        additionally grown to hold the edge labels landing inside it (a
        channel by its widest label demand, a gutter by one line per
        label) and floored by the configured minimum width/height  */
    const chanW = Array.from({ length: ncols }, (_, c) => {
        const cnt = chanCnt.get(c) ?? 0
        return Math.min(config["graph-channel-width-max"],
            Math.max(config["graph-channel-width-min"],
                cnt === 0 ? CHAN_W0 : CHAN_W1 + (cnt - 1) * config["size-edge-track-gap"],
                chanLbl.get(c) ?? 0))
    })
    const gutH = Array.from({ length: nrows }, (_, g) => {
        const cnt = gutCnt.get(g) ?? 0
        const lbl = gutLbl.get(g) ?? 0
        return Math.min(config["graph-gutter-height-max"],
            Math.max(config["graph-gutter-height-min"],
                cnt === 0 ? GUT_H0 : GUT_H1 + (cnt - 1) * config["size-edge-track-gap"],
                lbl > 0 ? GUT_H1 + lbl * GUT_LBL : 0))
    })

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
    return { colWidth, rowHeight, chanW, gutH, colCX, rowCY }
}

/*  assign the parallel tracks within the channels and gutters and derive
    the resulting track coordinate functions (see assignTracks for the
    crossing-avoiding ordering scheme, with backward edges entering the
    channel mirrored from the right side; the gutters use the very same
    scheme, just transposed: edges dropping in from above enter from the
    near side, edges rising from below are the mirrored users)  */
const assignTrackCoords = (
    edges:   Edge[],
    plans:   RoutePlan[],
    portPos: Map<string, { x: number, y: number }>,
    grid:    Grid,
    config:  Config
): { chanX: (c: number, edge: number) => number, gutY: (g: number, edge: number) => number } => {
    const { colWidth, rowHeight, chanW, gutH, colCX, rowCY } = grid
    const gutBase = (g: number) => rowCY[g] + rowHeight[g] / 2 + gutH[g] / 2

    /*  assign the vertical tracks within the inter-column channels  */
    const chanUsers = new Map<number, TrackUser[]>()
    edges.forEach((_, i) => {
        const { chans, guts, flags } = plans[i]
        if (chans.length === 0)
            return
        const sp = portPos.get(`${i}:s`)!
        const tp = portPos.get(`${i}:t`)!
        if (chans.length === 1)
            pushTo(chanUsers, chans[0], { edge: i, posIn: sp.y, posOut: tp.y, ...flags[0] })
        else {
            const gy = gutBase(guts[0])
            pushTo(chanUsers, chans[0], { edge: i, posIn: sp.y, posOut: gy,   ...flags[0] })
            pushTo(chanUsers, chans[1], { edge: i, posIn: gy,   posOut: tp.y, ...flags[1] })
        }
    })
    const chanOff = new Map<string, number>()
    for (const [ c, users ] of chanUsers)
        for (const [ edge, off ] of assignTracks(users, chanW[c], CHAN_PAD, config["size-edge-track-gap"]))
            chanOff.set(`${c}:${edge}`, off)
    const chanX = (c: number, edge: number) => colCX[c] + colWidth[c] / 2 + chanW[c] / 2 +
        chanOff.get(`${c}:${edge}`)!

    /*  assign the horizontal tracks within the inter-row gutters  */
    const gutUsers = new Map<number, TrackUser[]>()
    edges.forEach((_, i) => {
        const { chans, guts } = plans[i]
        if (guts.length === 0)
            return
        const sp = portPos.get(`${i}:s`)!
        pushTo(gutUsers, guts[0], {
            edge:   i,
            posIn:  chanX(chans[0], i),
            posOut: chanX(chans[1], i),
            mirror: sp.y > gutBase(guts[0])
        })
    })
    const gutOff = new Map<string, number>()
    for (const [ g, users ] of gutUsers)
        for (const [ edge, off ] of assignTracks(users, gutH[g], GUT_PAD, config["size-edge-track-gap"]))
            gutOff.set(`${g}:${edge}`, off)
    const gutY = (g: number, edge: number) => gutBase(g) + gutOff.get(`${g}:${edge}`)!
    return { chanX, gutY }
}

/*  route every edge as an orthogonal polyline through the channels
    between columns and the gutters between rows  */
const routePolys = (
    edges:   Edge[],
    plans:   RoutePlan[],
    portPos: Map<string, { x: number, y: number }>,
    boxW:    Map<string, number>,
    boxH:    Map<string, number>,
    cx:      (id: string) => number,
    cy:      (id: string) => number,
    chanX:   (c: number, edge: number) => number,
    gutY:    (g: number, edge: number) => number,
    config:  Config
): Poly[] => {
    const loopUse = new Map<string, number>()
    return edges.map((edge, i) => {
        const sp = portPos.get(`${i}:s`)!
        const tp = portPos.get(`${i}:t`)!
        const { chans, guts, flags } = plans[i]
        let pts: Poly
        if (edge.source === edge.target) {
            /*  route the self-loop counter-clockwise around the top-right
                box corner: out on the east side, up beside the box, back
                left above it, and down into the north side again (the
                detour above the box is the wider one, as its final
                descent has to stay readable behind the arrow head)  */
            const k   = loopUse.get(edge.source) ?? 0
            loopUse.set(edge.source, k + 1)
            const off = k * config["size-edge-track-gap"]
            const ox  = cx(edge.source) + boxW.get(edge.source)! / 2 + LOOP_GAP + off
            const oy  = cy(edge.source) - boxH.get(edge.source)! / 2 - LOOP_TOP - off
            pts = [ [ sp.x, sp.y ], [ ox, sp.y ], [ ox, oy ], [ tp.x, oy ], [ tp.x, tp.y ] ]
        }
        else if (chans.length === 1) {
            const ch = chanX(chans[0], i)
            if (!flags[0].hairpin && sp.y === tp.y)
                pts = [ [ sp.x, sp.y ], [ tp.x, tp.y ] ]
            else
                pts = [ [ sp.x, sp.y ], [ ch, sp.y ], [ ch, tp.y ], [ tp.x, tp.y ] ]
        }
        else {
            const ch1 = chanX(chans[0], i)
            const ch2 = chanX(chans[1], i)
            const gy  = gutY(guts[0], i)
            pts = [ [ sp.x, sp.y ], [ ch1, sp.y ], [ ch1, gy ], [ ch2, gy ], [ ch2, tp.y ], [ tp.x, tp.y ] ]
        }
        return simplifyPoly(pts)
    })
}

/*  the routing of all edges: the attachment ports, the gutter track
    positions, the polylines, and the number of crossings between them  */
interface Routing {
    portPos: Map<string, { x: number, y: number }>
    gutY:    (g: number, edge: number) => number
    polys:   Poly[]
    hops:    number
}

/*  route every edge for the given node positions: distribute the
    attachment ports along each node side and assign the parallel tracks
    within the channels and gutters, provisionally, to learn the gutter
    track every edge follows, then re-distribute the ports with every
    gutter-routed edge ordered by its actual gutter track approach
    instead of the opposite node position (which can disagree and would
    cross the edges right in front of their attachments), re-assign the
    tracks on top of the moved ports and finally route every edge as an
    orthogonal polyline through the channels between the columns and
    the gutters between the rows  */
const routeEdges = (
    edges:   Edge[],
    plans:   RoutePlan[],
    sides:   { s: Side, t: Side }[],
    boxW:    Map<string, number>,
    boxH:    Map<string, number>,
    cx:      (id: string) => number,
    cy:      (id: string) => number,
    grid:    Grid,
    config:  Config,
    level:   LevelContext
): Routing => {
    const portPre  = assignPorts(edges, sides, cx, cy, boxW, boxH, config["size-edge-port-gap"],
        undefined, level.fixedPort)
    const trackPre = assignTrackCoords(edges, plans, portPre, grid, config)
    const portPos  = assignPorts(edges, sides, cx, cy, boxW, boxH, config["size-edge-port-gap"],
        (edge) => plans[edge].guts.length > 0 ?
            trackPre.gutY(plans[edge].guts[0], edge) : undefined, level.fixedPort)
    const { chanX, gutY } = assignTrackCoords(edges, plans, portPos, grid, config)
    const polys = routePolys(edges, plans, portPos, boxW, boxH, cx, cy, chanX, gutY, config)
    const hops  = computeHops(polys).reduce((sum, segs) =>
        sum + Array.from(segs.values()).reduce((n, xs) => n + xs.length, 0), 0)
    return { portPos, gutY, polys, hops }
}

/*  nudge nodes vertically off their row centers to straighten the
    direct edges to their same-row neighbors in the adjacent columns, as
    far as this improves the overall routing (fewer crossings, or as many
    crossings but fewer jogged direct edges): a node may leave its row
    band into an adjacent gutter only as far as no gutter track runs
    across its column (and it carries no self-loop, detouring above its
    box), and only as long as its own gutter-routed edges keep
    approaching it from their gutter side  */
const nudgeNodes = (
    nodes:  Node[],
    edges:  Edge[],
    plans:  RoutePlan[],
    col:    Map<string, number>,
    row:    Map<string, number>,
    boxH:   Map<string, number>,
    grid:   Grid,
    nrows:  number,
    dy:     Map<string, number>,
    route:  () => Routing
): Routing => {
    const gutterFree = (g: number, c: number): boolean =>
        !plans.some((plan) => plan.guts[0] === g
            && Math.min(...plan.chans) < c && c <= Math.max(...plan.chans))
    const shiftRange = (id: string): [ number, number ] => {
        const r     = row.get(id)!
        const c     = col.get(id)!
        const slack = (grid.rowHeight[r] - boxH.get(id)!) / 2
        const loop  = edges.some((edge) => edge.source === id && edge.target === id)
        const up    = r > 0         && gutterFree(r - 1, c) && !loop ? grid.gutH[r - 1] - GUT_H0 : 0
        const down  = r < nrows - 1 && gutterFree(r, c)               ? grid.gutH[r]     - GUT_H0 : 0
        return [ -(slack + up), slack + down ]
    }
    const approachesSanely = (id: string, routing: Routing): boolean =>
        edges.every((edge, i) => {
            const role = edge.source === id ? "s" : edge.target === id ? "t" : null
            if (role === null || plans[i].guts.length === 0)
                return true
            const g   = plans[i].guts[0]
            const gap = routing.portPos.get(`${i}:${role}`)!.y - routing.gutY(g, i)
            return row.get(id)! > g ? gap >= NUDGE_GAP : gap <= -NUDGE_GAP
        })
    const direct = edges.map((edge, i) => plans[i].chans.length === 1
        && !plans[i].flags[0].hairpin
        && row.get(edge.source) === row.get(edge.target))
    const jogs = (routing: Routing): number =>
        edges.filter((_, i) => direct[i]
            && routing.portPos.get(`${i}:s`)!.y !== routing.portPos.get(`${i}:t`)!.y).length
    const better = (a: Routing, b: Routing): boolean =>
        a.hops < b.hops || (a.hops === b.hops && jogs(a) < jogs(b))

    /*  try, in a few passes, for every node the shifts aligning one of
        its direct edges, and keep the best of the shifts improving the
        routing (all shifts are relative to the current position, which
        already includes the shifts of the previous passes)  */
    let current = route()
    for (let pass = 0; pass < NUDGE_PASSES; pass++) {
        let changed = false
        for (const node of nodes) {
            const [ lo, hi ] = shiftRange(node.id)
            const shifts = new Set<number>()
            edges.forEach((edge, i) => {
                if (!direct[i])
                    return
                const sp = current.portPos.get(`${i}:s`)!
                const tp = current.portPos.get(`${i}:t`)!
                if (edge.source === node.id)
                    shifts.add(tp.y - sp.y)
                else if (edge.target === node.id)
                    shifts.add(sp.y - tp.y)
            })
            const base = dy.get(node.id) ?? 0
            let best: { shift: number, routing: Routing } | undefined
            for (const shift of shifts) {
                if (shift === 0 || base + shift < lo || base + shift > hi)
                    continue
                dy.set(node.id, base + shift)
                const routing = route()
                if (approachesSanely(node.id, routing) && better(routing, best?.routing ?? current))
                    best = { shift: base + shift, routing }
            }
            dy.set(node.id, best?.shift ?? base)
            if (best !== undefined) {
                current = best.routing
                changed = true
            }
        }
        if (!changed)
            break
    }
    return current
}

/*  determine the attachment sides of every edge, derived from the
    column relation of its endpoint nodes (a self-loop leaves on the
    east side and re-enters on the north side of its own box), except
    for an edge end attaching at a fixed port of a container box,
    which always uses the side of the inner gate: the west side
    when entering the container, the east side when leaving it  */
const attachSides = (
    edges: Edge[],
    col:   Map<string, number>,
    level: LevelContext
): { s: Side, t: Side }[] =>
    edges.map((edge, i) => {
        const sc = col.get(edge.source)!
        const tc = col.get(edge.target)!
        if (edge.source === edge.target)
            return { s: "e", t: "n" }
        const s: Side = level.fixedPort?.(i, "s") !== undefined ? "e" : sc <= tc ? "e" : "w"
        const t: Side = level.fixedPort?.(i, "t") !== undefined ? "w" : sc <  tc ? "w" : "e"
        return { s, t }
    })

/*  grow every box whose edge attachments exceed the configured
    per-side maximum, step-wise by one port separation per
    additional edge, so the edges keep enough attachment room
    without a fixed height increase (the fixed-size boxes of a
    containment level are exempt)  */
const growBoxes = (
    nodes:  Node[],
    edges:  Edge[],
    sides:  { s: Side, t: Side }[],
    boxH:   Map<string, number>,
    config: Config,
    level:  LevelContext
): void => {
    const portCnt = new Map<string, number>()
    edges.forEach((edge, i) => {
        portCnt.set(`${sides[i].s}:${edge.source}`, (portCnt.get(`${sides[i].s}:${edge.source}`) ?? 0) + 1)
        portCnt.set(`${sides[i].t}:${edge.target}`, (portCnt.get(`${sides[i].t}:${edge.target}`) ?? 0) + 1)
    })
    for (const node of nodes) {
        if (level.fixedSize?.has(node.id))
            continue
        const cnt = Math.max(portCnt.get(`w:${node.id}`) ?? 0, portCnt.get(`e:${node.id}`) ?? 0)
        if (cnt > config["graph-node-degree-max"])
            boxH.set(node.id, boxH.get(node.id)! +
                (cnt - config["graph-node-degree-max"]) * config["size-edge-port-gap"])
    }
}

/*  lay out a directed graph model (for a containment level: with the
    container placeholders at their fixed sizes, the edge ends attaching
    to them at their fixed ports, and the gate nodes on the boundary)  */
export const render = async (graph: Graph, config: Config, level: LevelContext = {}): Promise<Layout> => {
    const nodes = Array.from(graph.nodes.values())
    const edges = graph.edges

    /*  the gate nodes are kept out of the layered layout and the grid
        refinement, as they are placed into their own columns afterwards  */
    const gates     = level.gates ?? new Map<string, GateSide>()
    const real      = nodes.filter((node) => !gates.has(node.id))
    const realEdges = edges.filter((edge) => !gates.has(edge.source) && !gates.has(edge.target))

    /*  determine node box sizes from their textual content
        (all boxes at half height scale, grown by their edge
        attachment needs once the attachment sides are known)  */
    const { boxW, boxH, contentH } = measureNodes(nodes, config,
        () => config["size-node-height-scale"] / 2, level.fixedSize)

    /*  determine raw node positions with the AntV Dagre layout  */
    const rawX = new Map<string, number>()
    const rawY = new Map<string, number>()
    if (real.length > 0) {
        const layout = new DagreLayout({
            rankdir:  "LR",
            nodesep:  config["graph-node-separation"],
            ranksep:  config["graph-rank-separation"],
            nodeSize: (node) => (node as { size: [ number, number ] }).size
        })
        await layout.execute({
            nodes: real.map((node) => ({ id: node.id, size: [ boxW.get(node.id)!, boxH.get(node.id)! ] })),
            edges: realEdges.map((edge, i) => ({ id: `e${i}`, source: edge.source, target: edge.target }))
        })
        layout.forEachNode((node) => {
            rawX.set(String(node.id), node.x)
            rawY.set(String(node.id), node.y)
        })
    }

    /*  snap the raw positions onto the discrete column/row grid  */
    const { col, row, ncols: gridCols, nrows: gridRows } = snapToGrid(real, rawX, rawY)

    /*  refine the row assignment by pulling every node vertically
        toward the median row of its direct neighbors  */
    refineRows(real, realEdges, col, row)

    /*  fold the grid columns: constrain the diagram width to at most
        the configured maximum of side-by-side nodes by wrapping excess
        columns into additional row bands below, so wide graphs grow in
        height  */
    const maxCols = Math.max(Math.floor(config["graph-columns-max"]), 1)
    if (gridCols > maxCols) {
        for (const node of real) {
            const c = col.get(node.id)!
            col.set(node.id, c % maxCols)
            row.set(node.id, row.get(node.id)! + Math.floor(c / maxCols) * gridRows)
        }
    }

    /*  compact the sparsely occupied grid rows into fewer, denser ones,
        then place the gate nodes into their own boundary columns  */
    let { ncols, nrows } = placeGates(gates, edges, col, row,
        Math.min(gridCols, maxCols), compactRows(real, realEdges, col, row))

    /*  determine the attachment sides of every edge  */
    const sides = attachSides(edges, col, level)

    /*  plan the coarse channel/gutter route of every edge (a west side
        attachment in the first column needs a channel left of it, so
        the whole grid is shifted one column to the right then)  */
    let routes = planRoutes(edges, col, row, sides)
    if (routes.plans.some((plan) => plan.chans.some((c) => c < 0))) {
        for (const node of nodes)
            col.set(node.id, col.get(node.id)! + 1)
        ncols++
        routes = planRoutes(edges, col, row, sides)
    }
    const { plans, chanCnt, gutCnt, chanLbl, gutLbl } = routes

    /*  grow the boxes by their edge attachment needs  */
    growBoxes(nodes, edges, sides, boxH, config, level)

    /*  determine grid cell sizes and node center positions (the nodes
        centered in their rows, before any vertical nudging)  */
    const grid = computeGrid(nodes, col, row, boxW, boxH, ncols, nrows,
        chanCnt, gutCnt, chanLbl, gutLbl, config)
    const dy   = new Map<string, number>()
    const cx   = (id: string) => grid.colCX[col.get(id)!]
    const cy   = (id: string) => grid.rowCY[row.get(id)!] + (dy.get(id) ?? 0)

    /*  route the edges for the current node positions  */
    const route = () => routeEdges(edges, plans, sides, boxW, boxH, cx, cy, grid, config, level)

    /*  nudge nodes vertically off their row centers where this
        straightens edges and thereby simplifies the routing  */
    const routing = nudgeNodes(nodes, edges, plans, col, row, boxH, grid, nrows, dy, route)

    /*  hand over the laid out graph for SVG rendering  */
    return { nodes, edges, cx, cy, boxW, boxH, contentH, polys: routing.polys }
}

