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
import { Poly }                              from "./gradia-api-render-base.js"
import { measureNodes }                      from "./gradia-api-render-node.js"
import { Layout }                            from "./gradia-api-render-svg.js"
import { Side, TrackUser, PORT_SEP, simplifyPoly, assignPorts, assignTracks } from "./gradia-api-render-edge.js"

/*  rendering geometry constants  */
const CLUSTX   = 26  /*  max X distance within a grid column         */
const CLUSTY   = 72  /*  max Y distance within a grid row            */
const CHAN_W0  = 24  /*  width of an edge-less inter-column channel  */
const CHAN_W1  = 28  /*  width of a one-edge inter-column channel    */
const CHAN_PAD = 16  /*  cross-axis padding inside a channel         */
const GUT_H0   = 20  /*  height of an edge-less inter-row gutter     */
const GUT_H1   = 24  /*  height of a one-edge inter-row gutter       */
const GUT_PAD  = 12  /*  cross-axis padding inside a gutter          */
const LOOP_GAP = 24  /*  detour of a self-loop right of its node box */

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
    for (const node of nodes) {
        col.set(node.id, nearestIndexOf(colReps, rawX.get(node.id)!))
        row.set(node.id, nearestIndexOf(rowReps, rawY.get(node.id)!))
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

/*  the coarse route of an edge: the inter-column channels and the
    inter-row gutters it occupies  */
interface RoutePlan {
    chans: number[]
    guts:  number[]
}

/*  plan the coarse route of every edge: which inter-column channels
    and inter-row gutters it occupies (based on grid indices only)  */
const planRoutes = (
    edges: Edge[],
    col:   Map<string, number>,
    row:   Map<string, number>
): { plans: RoutePlan[], chanCnt: Map<number, number>, gutCnt: Map<number, number> } => {
    const plans = edges.map((edge): RoutePlan => {
        /*  a self-loop is routed around its own node box and uses no channel  */
        if (edge.source === edge.target)
            return { chans: [], guts: [] }
        const sc = col.get(edge.source)!
        const tc = col.get(edge.target)!
        const sr = row.get(edge.source)!
        const tr = row.get(edge.target)!
        let chans: number[]
        let guts:  number[] = []
        if (sc === tc)
            chans = [ sc ]
        else if (Math.abs(sc - tc) === 1)
            chans = [ Math.min(sc, tc) ]
        else {
            chans = [ sc < tc ? sc : sc - 1, sc < tc ? tc - 1 : tc ]
            guts  = [ tr > sr ? tr - 1 : tr ]
        }
        return { chans, guts }
    })

    /*  count the edges occupying each channel and gutter  */
    const chanCnt = new Map<number, number>()
    const gutCnt  = new Map<number, number>()
    for (const plan of plans) {
        for (const c of plan.chans)
            chanCnt.set(c, (chanCnt.get(c) ?? 0) + 1)
        for (const g of plan.guts)
            gutCnt.set(g, (gutCnt.get(g) ?? 0) + 1)
    }
    return { plans, chanCnt, gutCnt }
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
    config:  Config
): Grid => {
    const colWidth  = Array.from({ length: ncols }, () => 0)
    const rowHeight = Array.from({ length: nrows }, () => 0)
    for (const node of nodes) {
        colWidth[col.get(node.id)!]   = Math.max(colWidth[col.get(node.id)!],   boxW.get(node.id)!)
        rowHeight[row.get(node.id)!]  = Math.max(rowHeight[row.get(node.id)!],  boxH.get(node.id)!)
    }

    /*  size the channels and gutters by their actual edge usage  */
    const chanW = Array.from({ length: ncols }, (_, c) => {
        const cnt = chanCnt.get(c) ?? 0
        return cnt === 0 ? CHAN_W0 : Math.min(config["graph-channel-width-max"],
            CHAN_W1 + (cnt - 1) * config["size-edge-track-gap"])
    })
    const gutH = Array.from({ length: nrows }, (_, g) => {
        const cnt = gutCnt.get(g) ?? 0
        return cnt === 0 ? GUT_H0 : Math.min(config["graph-gutter-height-max"],
            GUT_H1 + (cnt - 1) * config["size-edge-track-gap"])
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
    col:     Map<string, number>,
    portPos: Map<string, { x: number, y: number }>,
    grid:    Grid,
    config:  Config
): { chanX: (c: number, edge: number) => number, gutY: (g: number, edge: number) => number } => {
    const { colWidth, rowHeight, chanW, gutH, colCX, rowCY } = grid
    const gutBase = (g: number) => rowCY[g] + rowHeight[g] / 2 + gutH[g] / 2

    /*  assign the vertical tracks within the inter-column channels  */
    const chanUsers = new Map<number, TrackUser[]>()
    edges.forEach((edge, i) => {
        const { chans, guts } = plans[i]
        if (chans.length === 0)
            return
        const mirror = col.get(edge.target)! < col.get(edge.source)!
        const sp = portPos.get(`${i}:s`)!
        const tp = portPos.get(`${i}:t`)!
        if (chans.length === 1)
            pushTo(chanUsers, chans[0], { edge: i, posIn: sp.y, posOut: tp.y, mirror })
        else {
            const gy = gutBase(guts[0])
            pushTo(chanUsers, chans[0], { edge: i, posIn: sp.y, posOut: gy,   mirror })
            pushTo(chanUsers, chans[1], { edge: i, posIn: gy,   posOut: tp.y, mirror })
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
    col:     Map<string, number>,
    portPos: Map<string, { x: number, y: number }>,
    boxW:    Map<string, number>,
    cx:      (id: string) => number,
    chanX:   (c: number, edge: number) => number,
    gutY:    (g: number, edge: number) => number,
    config:  Config
): Poly[] => {
    const loopUse = new Map<string, number>()
    return edges.map((edge, i) => {
        const sc = col.get(edge.source)!
        const tc = col.get(edge.target)!
        const sp = portPos.get(`${i}:s`)!
        const tp = portPos.get(`${i}:t`)!
        const { chans, guts } = plans[i]
        let pts: Poly
        if (edge.source === edge.target) {
            const k  = loopUse.get(edge.source) ?? 0
            loopUse.set(edge.source, k + 1)
            const ox = cx(edge.source) + boxW.get(edge.source)! / 2 + LOOP_GAP +
                k * config["size-edge-track-gap"]
            pts = [ [ sp.x, sp.y ], [ ox, sp.y ], [ ox, tp.y ], [ tp.x, tp.y ] ]
        }
        else if (chans.length === 1) {
            const ch = chanX(chans[0], i)
            if (Math.abs(sc - tc) === 1 && sp.y === tp.y)
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

/*  lay out a directed graph model  */
export const render = async (graph: Graph, config: Config): Promise<Layout> => {
    const nodes = Array.from(graph.nodes.values())
    const edges = graph.edges

    /*  determine node box sizes from their textual content
        (all boxes at half height scale, grown by their edge
        attachment needs once the attachment sides are known)  */
    const { boxW, boxH, contentH } = measureNodes(nodes, config, () => config["size-node-height-scale"] / 2)

    /*  determine raw node positions with the AntV Dagre layout  */
    const layout = new DagreLayout({
        rankdir:  "LR",
        nodesep:  config["graph-node-separation"],
        ranksep:  config["graph-rank-separation"],
        nodeSize: (node) => (node as { size: [ number, number ] }).size
    })
    await layout.execute({
        nodes: nodes.map((node) => ({ id: node.id, size: [ boxW.get(node.id)!, boxH.get(node.id)! ] })),
        edges: edges.map((edge, i) => ({ id: `e${i}`, source: edge.source, target: edge.target }))
    })
    const rawX = new Map<string, number>()
    const rawY = new Map<string, number>()
    layout.forEachNode((node) => {
        rawX.set(String(node.id), node.x)
        rawY.set(String(node.id), node.y)
    })

    /*  snap the raw positions onto the discrete column/row grid  */
    const { col, row, ncols: gridCols, nrows: gridRows } = snapToGrid(nodes, rawX, rawY)

    /*  refine the row assignment by pulling every node vertically
        toward the median row of its direct neighbors  */
    refineRows(nodes, edges, col, row)

    /*  fold the grid columns: constrain the diagram width to at most
        the configured maximum of side-by-side nodes by wrapping excess
        columns into additional row bands below, so wide graphs grow in
        height  */
    const maxCols = Math.max(Math.floor(config["graph-columns-max"]), 1)
    if (gridCols > maxCols) {
        for (const node of nodes) {
            const c = col.get(node.id)!
            col.set(node.id, c % maxCols)
            row.set(node.id, row.get(node.id)! + Math.floor(c / maxCols) * gridRows)
        }
    }
    const ncols = Math.min(gridCols, maxCols)

    /*  drop the grid rows which are completely empty  */
    const usedRows = Array.from(new Set(nodes.map((node) => row.get(node.id)!))).sort((a, b) => a - b)
    const rowIdx   = new Map(usedRows.map((r, idx) => [ r, idx ]))
    for (const node of nodes)
        row.set(node.id, rowIdx.get(row.get(node.id)!)!)
    const nrows = usedRows.length

    /*  plan the coarse channel/gutter route of every edge  */
    const { plans, chanCnt, gutCnt } = planRoutes(edges, col, row)

    /*  determine the attachment sides of every edge (east/west),
        derived from the column relation of its endpoint nodes  */
    const sides: { s: Side, t: Side }[] = edges.map((edge) => {
        const sc = col.get(edge.source)!
        const tc = col.get(edge.target)!
        if      (sc < tc) return { s: "e", t: "w" }
        else if (sc > tc) return { s: "w", t: "e" }
        else              return { s: "e", t: "e" }
    })

    /*  grow every box whose edge attachments exceed the configured
        per-side maximum, step-wise by one port separation per
        additional edge, so the edges keep enough attachment room
        without a fixed height increase  */
    const portCnt = new Map<string, number>()
    edges.forEach((edge, i) => {
        portCnt.set(`${sides[i].s}:${edge.source}`, (portCnt.get(`${sides[i].s}:${edge.source}`) ?? 0) + 1)
        portCnt.set(`${sides[i].t}:${edge.target}`, (portCnt.get(`${sides[i].t}:${edge.target}`) ?? 0) + 1)
    })
    for (const node of nodes) {
        const cnt = Math.max(portCnt.get(`w:${node.id}`) ?? 0, portCnt.get(`e:${node.id}`) ?? 0)
        if (cnt > config["graph-node-degree-max"])
            boxH.set(node.id, boxH.get(node.id)! +
                (cnt - config["graph-node-degree-max"]) * PORT_SEP)
    }

    /*  determine grid cell sizes and final node center positions  */
    const grid = computeGrid(nodes, col, row, boxW, boxH, ncols, nrows, chanCnt, gutCnt, config)
    const cx   = (id: string) => grid.colCX[col.get(id)!]
    const cy   = (id: string) => grid.rowCY[row.get(id)!]

    /*  distribute the edge attachment ports along each node side  */
    const portPos = assignPorts(edges, sides, cx, cy, boxW, boxH)

    /*  assign the parallel tracks within the channels and gutters  */
    const { chanX, gutY } = assignTrackCoords(edges, plans, col, portPos, grid, config)

    /*  route every edge as an orthogonal polyline through the channels
        between columns and the gutters between rows  */
    const polys = routePolys(edges, plans, col, portPos, boxW, cx, chanX, gutY, config)

    /*  hand over the laid out graph for SVG rendering  */
    return { nodes, edges, cx, cy, boxW, boxH, contentH, polys }
}

