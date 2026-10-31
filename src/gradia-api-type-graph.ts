/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  external dependencies  */
import { DagreLayout } from "@antv/layout"

/*  internal dependencies  */
import { Graph, Node }                       from "./gradia-api-model.js"
import { Config }                            from "./gradia-api-config.js"
import { extentOf, Layout }                  from "./gradia-api-render-base.js"
import { measureNodes, orderOf }             from "./gradia-api-render-node.js"
import { LevelContext, GateSide }            from "./gradia-api-render-container.js"
import { CLUSTY, snapToGrid, refineRows, compactRows, placeGates }
    from "./gradia-api-type-graph-place.js"
import { Merge, planRoutes, attachSides, growBoxes }
    from "./gradia-api-type-graph-plan.js"
import { Need, Uniform, computeGrid, packColumns }
    from "./gradia-api-type-graph-grid.js"
import { Routing, routeEdges, nudgeNodes, targetKey, sourceKey }
    from "./gradia-api-type-graph-route.js"

/*  re-exported companion API  */
export type { Uniform }                      from "./gradia-api-type-graph-grid.js"
export { loopRise }                          from "./gradia-api-type-graph-grid.js"

/*  the maximum number of passes sizing the crowded channels and gutters  */
const GROW_PASSES = 4

/*  place the nodes of an explicitly ordered graph onto the grid by
    their order values (see render) and return the grid dimensions  */
const placeOrdered = (real: Node[], maxCols: number, transposed: boolean,
    col: Map<string, number>, row: Map<string, number>): { ncols: number, nrows: number } => {
    const orderOrLast = (node: Node): number => orderOf(node) ?? Infinity
    const values      = Array.from(new Set(real.map(orderOrLast))).sort((a, b) => a - b)
    let   ncols       = 1
    let   nrows       = 0
    if (transposed) {
        /*  a transposed uniform layout instead turns the order values
            into the columns, left-to-right, the nodes of one value
            filling their column top-down in declaration order (never
            wrapped), and the nodes without an order the trailing column  */
        ncols = values.length
        nrows = 1
        values.forEach((value, c) => {
            real.filter((node) => orderOrLast(node) === value).forEach((node, i) => {
                col.set(node.id, c)
                row.set(node.id, i)
                nrows = Math.max(nrows, i + 1)
            })
        })
    }
    else {
        for (const value of values) {
            const members = real.filter((node) => orderOrLast(node) === value)
            members.forEach((node, i) => {
                col.set(node.id, i % maxCols)
                row.set(node.id, nrows + Math.floor(i / maxCols))
            })
            ncols  = Math.max(ncols, Math.min(members.length, maxCols))
            nrows += Math.ceil(members.length / maxCols)
        }
    }
    return { ncols, nrows }
}

/*  lay out a directed graph model (for a containment level: with the
    container placeholders at their fixed sizes, the edge ends attaching
    to them at their fixed ports, and the gate nodes on the boundary,
    for a uniform layout, with its boxes and gutters unified, and, for
    distinct edges, e.g. the transitions of a "state" diagram, without
    bundling the edges of the same name)  */
export const render = async (graph: Graph, config: Config, level: LevelContext = {},
    uniform?: Uniform, distinct = false): Promise<Layout> => {
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

    const maxCols = Math.max(Math.floor(config["graph-columns-max"]), 1)
    const col     = new Map<string, number>()
    const row     = new Map<string, number>()
    let   ncols: number
    let   nrows: number
    const ordered = real.some((node) => orderOf(node) !== undefined)

    /*  only the layered layout packs its columns (see packColumns), as an
        explicitly ordered graph keeps its rows and a uniform one its lanes  */
    const packed = !ordered && uniform === undefined
    if (ordered) {
        /*  an explicitly ordered graph (at least one node carrying an
            "order" attribute) bypasses the layered layout: the distinct
            order values become the rows, top-down in ascending order,
            the nodes of one value fill their row left-to-right in
            declaration order (wrapped into further rows beyond the
            configured maximum of side-by-side nodes), and the nodes
            without an order follow in the trailing rows  */
        ({ ncols, nrows } = placeOrdered(real, maxCols, uniform?.transposed === true, col, row))
    }
    else {
        /*  determine raw node positions with the AntV Dagre layout, for the
            connected nodes only (Dagre would merely stack the edge-less
            ones into its first rank), with the edges to lay out as pointing
            backwards handed over reversed  */
        const rawX   = new Map<string, number>()
        const rawY   = new Map<string, number>()
        const linked = new Set<string>()
        for (const edge of realEdges) {
            linked.add(edge.source)
            linked.add(edge.target)
        }
        const connected = real.filter((node) =>  linked.has(node.id))
        const isolated  = real.filter((node) => !linked.has(node.id))
        if (connected.length > 0) {
            const layout = new DagreLayout({
                rankdir:  "LR",
                nodesep:  config["graph-node-separation"],
                ranksep:  config["graph-rank-separation"],
                nodeSize: (node) => (node as { size: [ number, number ] }).size
            })
            await layout.execute({
                nodes: connected.map((node) => ({ id: node.id, size: [ boxW.get(node.id)!, boxH.get(node.id)! ] })),
                edges: realEdges.map((edge, i) => level.backward?.has(edge) === true ?
                    { id: `e${i}`, source: edge.target, target: edge.source } :
                    { id: `e${i}`, source: edge.source, target: edge.target })
            })
            layout.forEachNode((node) => {
                rawX.set(String(node.id), node.x)
                rawY.set(String(node.id), node.y)
            })
        }

        /*  stack the edge-less nodes, in declaration order, into the
            first rank below all connected nodes, each into a row of its
            own (more than the row clustering threshold apart)  */
        const firstX = connected.reduce((x, node) => Math.min(x, rawX.get(node.id)!), Infinity)
        const lastY  = connected.reduce((y, node) => Math.max(y, rawY.get(node.id)!), -Infinity)
        isolated.forEach((node, i) => {
            rawX.set(node.id, Number.isFinite(firstX) ? firstX : 0)
            rawY.set(node.id, (Number.isFinite(lastY) ? lastY : 0) + (i + 1) * (CLUSTY + 1))
        })

        /*  snap the raw positions onto the discrete column/row grid  */
        const snapped = snapToGrid(real, rawX, rawY)
        for (const [ id, c ] of snapped.col)
            col.set(id, c)
        for (const [ id, r ] of snapped.row)
            row.set(id, r)

        /*  refine the row assignment by pulling every node vertically
            toward the median row of its direct neighbors  */
        refineRows(real, realEdges, col, row)

        /*  fold the grid columns: constrain the diagram width to at most
            the configured maximum of side-by-side nodes by wrapping excess
            columns into additional row bands below, so wide graphs grow in
            height (the edge-less nodes of packed columns into the last band)  */
        if (snapped.ncols > maxCols) {
            const last = Math.floor((snapped.ncols - 1) / maxCols)
            for (const node of real) {
                const c    = col.get(node.id)!
                const band = packed && !linked.has(node.id) ? last : Math.floor(c / maxCols)
                col.set(node.id, c % maxCols)
                row.set(node.id, row.get(node.id)! + band * snapped.nrows)
            }
        }

        /*  compact the sparsely occupied grid rows into fewer, denser ones  */
        ncols = Math.min(snapped.ncols, maxCols)
        nrows = compactRows(real, realEdges, col, row, !packed)
    }

    /*  in a single-column layout, widen the container placeholders to
        the widest one, so the stacked container boxes line up (their
        content stays centered and their height the one of their content)  */
    if (ncols === 1) {
        const fixed = real.filter((node) => level.fixedSize?.has(node.id))
        const width = fixed.reduce((a, node) => Math.max(a, boxW.get(node.id)!), 0)
        for (const node of fixed)
            boxW.set(node.id, width)
    }

    /*  place the gate nodes into their own boundary columns  */
    ({ ncols, nrows } = placeGates(gates, edges, col, row, ncols, nrows))

    /*  determine the attachment sides of every edge  */
    const sides = attachSides(edges, col, level)

    /*  plan the coarse channel/gutter route of every edge (a west side
        attachment in the first column needs a channel left of it, so
        the whole grid is shifted one column to the right then)  */
    let routes = planRoutes(edges, col, row, sides, gates, config)
    if (routes.plans.some((plan) => plan.chans.some((c) => c < 0))) {
        for (const node of nodes)
            col.set(node.id, col.get(node.id)! + 1)
        ncols++
        routes = planRoutes(edges, col, row, sides, gates, config)
    }
    const { plans, chanCnt, gutCnt, chanLbl, gutLbl, gutLoop } = routes

    /*  grow the boxes by their edge attachment needs (anew from their
        content sizes, once the edge ends merged into one port are known),
        and for a uniform layout let all boxes take the width of the
        widest one and the boxes of a lane the height of the highest one  */
    const sizedH = new Map(boxH)
    const sizeBoxes = (merged?: Merge) => {
        for (const [ id, h ] of sizedH)
            boxH.set(id, h)
        growBoxes(nodes, edges, sides, boxH, config, level, merged)
        if (uniform !== undefined) {
            const width  = Math.max(0, ...nodes.map((node) => boxW.get(node.id)!))
            const height = new Map<number, number>()
            for (const node of nodes) {
                const lane = uniform.laneOf(node.id)
                height.set(lane, Math.max(height.get(lane) ?? 0, boxH.get(node.id)!))
            }
            for (const node of nodes) {
                boxW.set(node.id, width)
                boxH.set(node.id, height.get(uniform.laneOf(node.id))!)
            }
        }
    }
    sizeBoxes()

    /*  determine grid cell sizes and node center positions (the nodes
        centered in their rows, or stacked in their packed columns, before
        any vertical nudging)  */
    const need: Need = { chan: new Map<number, number>(), gut: new Map<number, number>() }
    const layoutGrid = () => {
        const grid = computeGrid(nodes, col, row, boxW, boxH, ncols, nrows,
            chanCnt, gutCnt, chanLbl, gutLbl, gutLoop, uniform !== undefined, need, config)
        return packed ? packColumns(grid, nodes, edges, plans, col, row, boxH, nrows, config) : grid
    }
    let   grid = layoutGrid()
    const dy   = new Map<string, number>()
    const cx   = (id: string) => grid.colCX[col.get(id)!]
    const cy   = (id: string) => (grid.nodeCY?.get(id) ?? grid.rowCY[row.get(id)!]) + (dy.get(id) ?? 0)

    /*  route the edges for the current node positions (with the edge
        ends merged into one port, once determined)  */
    let   merged: Merge | undefined
    const route = () => routeEdges(edges, plans, sides, boxW, boxH, cx, cy, grid, config, level, merged,
        uniform?.markOf, distinct)

    /*  lay out the grid and route the edges, re-sizing the crowded
        channels and gutters by the needs of their bundled tracks until
        these settle (after the first pass they only grow), and finally
        nudge nodes vertically off their row centers where this
        straightens edges and thereby simplifies the routing (except for
        a uniform layout, whose lanes keep their boxes aligned)  */
    const layout = (): Routing => {
        need.chan.clear()
        need.gut.clear()
        dy.clear()
        grid = layoutGrid()
        let initial = route()
        for (let pass = 0; pass < GROW_PASSES; pass++) {
            let changed = false
            const settle = (to: Map<number, number>, from: Map<number, number>) => {
                for (const [ k, v ] of from) {
                    const size = pass === 0 ? v : Math.max(to.get(k) ?? 0, v)
                    if (size !== to.get(k)) {
                        to.set(k, size)
                        changed = true
                    }
                }
            }
            settle(need.chan, initial.need.chan)
            settle(need.gut,  initial.need.gut)
            if (!changed)
                break
            grid    = layoutGrid()
            initial = route()
        }
        return uniform !== undefined ? initial :
            nudgeNodes(nodes, edges, plans, col, row, boxH, grid, nrows, dy, route, initial)
    }
    let routing = layout()

    /*  let the bundles (of edges of the same name) leading to the same
        target node side with the same arity run into it as one, and the
        bundles coming from the same source node side run out of it as
        one: merge the edge ends of every such bundle (bound in the channel
        beside the node, not attaching at a fixed port or a gate) into one
        port, which frees the ports of the others, and lay out anew, but
        keep this only if it does not enlarge the diagram  */
    const ends  = new Map<string, string>()
    const count = new Map<string, number>()
    const bind  = (end: string, key: string) => {
        ends.set(end, key)
        count.set(key, (count.get(key) ?? 0) + 1)
    }
    edges.forEach((edge, i) => {
        const { chans, gate } = plans[i]
        if (edge.source === edge.target)
            return
        const tc = chans[chans.length - 1]
        const sc = chans[0]
        const tk = routing.keys.get(`${tc}:${i}`)
        const sk = routing.keys.get(`${sc}:${i}`)
        const mk = uniform?.markOf?.(edge)
        if (gate !== "t" && level.fixedPort?.(i, "t") === undefined && tk === targetKey(tc, edge, mk))
            bind(`${i}:t`, tk)
        if (gate !== "s" && level.fixedPort?.(i, "s") === undefined && sk === sourceKey(sc, edge, mk))
            bind(`${i}:s`, sk)
    })
    for (const [ end, key ] of ends)
        if (count.get(key)! < 2)
            ends.delete(end)
    if (ends.size > 0) {
        const extent = () => extentOf({ nodes, cx, cy, boxW, boxH, polys: routing.polys })
        const before = extent()
        merged = (edge, role) => ends.get(`${edge}:${role}`)
        sizeBoxes(merged)
        routing = layout()
        if (extent() > before) {
            merged = undefined
            sizeBoxes()
            routing = layout()
        }
    }

    /*  hand over the laid out graph for SVG rendering  */
    return { nodes, edges, cx, cy, boxW, boxH, contentH, polys: routing.polys,
        bundled: edges.map((_, i) => routing.bundled.has(i)),
        crowded: routing.need.chan.size > 0 || routing.need.gut.size > 0 }
}

