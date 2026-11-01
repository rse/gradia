/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Edge, Graph }              from "./gradia-api-model.js"
import { Config }                   from "./gradia-api-config.js"
import { Layout, FS_GROUP, textWidth }
    from "./gradia-api-render-base.js"
import { Shape, textShape, rectShape } from "./gradia-api-render-shape.js"
import { LevelContext, rejectContainers, boundsOf }
    from "./gradia-api-render-container.js"
import { bandsOf, clusterRuns, fitLabel }
    from "./gradia-api-render-cluster.js"
import { render as renderGraph }    from "./gradia-api-type-graph.js"

/*  the gap between two neighboring slice bands, the margin of a band
    around its node boxes, and the geometry of the clusters and numbers  */
const BAND_GAP    = 8
const BAND_MARGIN = 20
const CLUSTER_H   = 40   /*  height of a cluster row             */
const CLUSTER_GAP = 8    /*  gap between the cluster rows        */
const CLUSTER_PAD = 8    /*  padding along a cluster row name    */
const NUMBER_R    = 13   /*  radius of the circle of a number    */
const WIDEN_MAX   = 4    /*  max re-layouts widening channels    */

/*  lay out a graph model as a sliced architecture: the slices, in the
    order of their first appearance, become bands side-by-side
    left-to-right, and an edge from a right slice back to a left one,
    closing a direct cycle between the two slices, is marked as a violation  */
export const render = async (graph: Graph, config: Config, level: LevelContext = {}): Promise<Layout> => {
    /*  ensure the graph carries no containers, as the bands are the
        only nesting of a sliced diagram  */
    const nodes = Array.from(graph.nodes.values())
    rejectContainers("slice", nodes, level)

    /*  determine the slices in the order of their first appearance, with
        the slices of a cluster kept together (at the position of the first
        appearance of the cluster, on every nesting level), and lay out
        every slice as one explicitly ordered column of a "graph"  */
    const { names: slices, indexOf, ordered, parts } = bandsOf(graph, nodes, "slice")

    /*  an edge pointing from a right slice back to a left one violates the
        slicing if it closes a direct cycle, i.e., if any edge points from
        that left slice to the right one (no transitive cycles are checked),
        unless the marking of the violations is disabled  */
    const forward = new Set<string>()
    for (const edge of graph.edges) {
        const [ s, t ] = [ indexOf(edge.source), indexOf(edge.target) ]
        if (s !== undefined && t !== undefined && s < t)
            forward.add(`${s}:${t}`)
    }
    const violates = (edge: Edge): boolean => {
        const [ s, t ] = [ indexOf(edge.source), indexOf(edge.target) ]
        return config["mark-violation"] && s !== undefined && t !== undefined && s > t && forward.has(`${t}:${s}`)
    }

    /*  the rows of the nodes within their slices (or within the trailing
        column of the nodes without a slice), as the lanes of the uniform
        layout, so the boxes of a row take one height across all slices  */
    const rowOf = new Map<string, number>()
    const count = new Map<number, number>()
    for (const node of nodes) {
        const i = indexOf(node.id) ?? -1
        rowOf.set(node.id, count.get(i) ?? 0)
        count.set(i, (count.get(i) ?? 0) + 1)
    }

    /*  determine the horizontal extent of every slice (with the trailing
        column of the nodes without a slice last) from its node boxes and
        the routes of its intra-slice edges, which run through the channel
        right of its column (and hence have to stay within its band)  */
    const extentsOf = (layout: Layout) => {
        const n     = slices.length + 1
        const boxL  = Array.from({ length: n }, () => Infinity)
        const boxR  = Array.from({ length: n }, () => -Infinity)
        const right = Array.from({ length: n }, () => -Infinity)
        for (const node of layout.nodes) {
            const i = indexOf(node.id) ?? slices.length
            const w = layout.boxW.get(node.id)! / 2
            boxL[i]  = Math.min(boxL[i], layout.cx(node.id) - w)
            boxR[i]  = Math.max(boxR[i], layout.cx(node.id) + w)
            right[i] = Math.max(right[i], boxR[i])
        }
        layout.edges.forEach((edge, k) => {
            const i = indexOf(edge.source)
            if (i === undefined || i !== indexOf(edge.target))
                return
            for (const [ x ] of layout.polys[k])
                right[i] = Math.max(right[i], x)
        })
        return { boxL, boxR, right }
    }

    /*  lay out the graph uniformly and transposed (see "Uniform"), with the
        channels holding at least the margins of the two bands beside them
        plus their gap, and widened (even beyond the configured maximum
        channel width) until the intra-slice edge routes of every slice
        stay within its band, clear of the band to its right (giving up
        after a few re-layouts, as the bands then merely touch)  */
    const pass = (chan: number) => {
        const cfg = { ...config,
            "graph-channel-width-min": Math.max(config["graph-channel-width-min"], chan),
            "graph-channel-width-max": Math.max(config["graph-channel-width-max"], chan) }
        return renderGraph(ordered, cfg, level, { laneOf: (id) => rowOf.get(id)!, markOf: violates, transposed: true })
    }
    let chan   = BAND_MARGIN * 2 + BAND_GAP
    let layout = await pass(chan)
    for (let k = 0; k < WIDEN_MAX; k++) {
        const { boxL, boxR, right } = extentsOf(layout)
        let want = chan
        for (let i = 0; i < slices.length; i++) {
            if (!Number.isFinite(boxL[i + 1]))
                continue
            const margin = i + 1 < slices.length ? BAND_MARGIN : 0
            const lack   = right[i] + BAND_MARGIN + BAND_GAP + margin - boxL[i + 1]
            if (lack > 0)
                want = Math.max(want, boxL[i + 1] - boxR[i] + 2 * lack)
        }
        if (want <= chan)
            break
        chan   = want
        layout = await pass(chan)
    }

    /*  draw every slice as a band spanning the whole diagram, its nodes
        horizontally enclosed by the same margin left and right of them,
        with the slice name (optionally preceded by its number) above its
        nodes in the bold font of the group tags, below the edges and the
        nodes  */
    const { boxL, right } = extentsOf(layout)
    const bounds   = boundsOf(layout)
    const pad      = config["group-box-padding"]
    const numbered = config["slice-numbered"]
    const numberW  = numbered ? NUMBER_R * 2 + 12 : 0
    const headH    = Math.max(FS_GROUP, numbered ? NUMBER_R * 2 : 0)
    const top      = bounds.minY - pad - headH - pad
    const bottom   = bounds.maxY + pad
    const mid      = top + pad + headH / 2
    const shapes: Shape[] = []
    const x1Of = (i: number) => boxL[i]  - BAND_MARGIN
    const x2Of = (i: number) => right[i] + BAND_MARGIN
    slices.forEach((name, i) => {
        const [ x1, x2 ] = [ x1Of(i), x2Of(i) ]
        shapes.push(rectShape(x1, top, x2 - x1, bottom - top, "color-container-border", 2,
            undefined, "color-container-box", 12))
        const { label, fs, w } = fitLabel(name, x2 - x1 - 2 * CLUSTER_PAD - numberW, FS_GROUP, 0.6, true)
        const start = (x1 + x2) / 2 - (numberW + w) / 2
        if (numbered) {
            const nfs = config["size-font-type"]
            const nr  = String(i + 1)
            shapes.push(rectShape(start, mid - NUMBER_R, NUMBER_R * 2, NUMBER_R * 2, "color-container-name", 2,
                undefined, "color-container-box", NUMBER_R))
            shapes.push(textShape(start + NUMBER_R, mid, nr, "middle", textWidth(nr, nfs, true),
                "color-container-name", "size-font-type", nfs, { bold: true, halo: false }))
        }
        shapes.push(textShape(start + numberW, mid, label, "start", w,
            "color-container-name", fs, fs, { bold: true, halo: false }))
    })

    /*  draw every cluster of slices as a row above the bands, nested
        clusters further down, spanning the bands of its slices, with its
        name centered (shrunk to fit, but at most to 60% of its font, beyond
        which the name is cut off with an ellipsis instead)  */
    const { depth, runs } = clusterRuns(parts)
    for (const { level: k, name, from, to } of runs) {
        const y = top - (depth - k) * (CLUSTER_H + CLUSTER_GAP)
        const [ x1, x2 ] = [ x1Of(from), x2Of(to - 1) ]
        const { label, fs, w } = fitLabel(name, x2 - x1 - 2 * CLUSTER_PAD, FS_GROUP, 0.6, true)
        shapes.push(rectShape(x1, y, x2 - x1, CLUSTER_H, "color-container-border", 2,
            undefined, "color-container-box", 12))
        shapes.push(textShape((x1 + x2) / 2, y + CLUSTER_H / 2, label, "middle", w,
            "color-container-name", fs, fs, { bold: true, halo: false }))
    }

    /*  hand over the laid out graph with the bands and the violations  */
    const marked = layout.edges.map((edge) => violates(edge))
    return { ...layout, shapes, marked }
}
