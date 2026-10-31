/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Edge, Graph }        from "./gradia-api-model.js"
import { Config }                   from "./gradia-api-config.js"
import { Layout, FS_GROUP, textWidth }
    from "./gradia-api-render-base.js"
import { Shape, textShape, rectShape } from "./gradia-api-render-shape.js"
import { LevelContext, rejectContainers, boundsOf }
    from "./gradia-api-render-container.js"
import { clusterOf }                from "./gradia-api-render-node.js"
import { render as renderGraph, loopRise }
    from "./gradia-api-type-graph.js"

/*  the gap between two neighboring layer bands, the margin of a band
    around its node boxes, and the geometry of the clusters and numbers  */
const BAND_GAP    = 8
const BAND_MARGIN = 20
const CLUSTER_W   = 40   /*  width of a cluster column            */
const CLUSTER_GAP = 8    /*  gap between the cluster columns      */
const CLUSTER_PAD = 8    /*  padding along a cluster column name  */
const NUMBER_R    = 13   /*  radius of the circle of a number     */

/*  the special "layer" annotation (the name of the layer of a node)  */
const layerOf = (node: Node): string | undefined =>
    node.attrs.findLast((attr) => attr.key === "layer")?.val

/*  lay out a graph model as a layered architecture: the layers, in the
    order of their first appearance, become bands stacked top-down, and
    an edge from a lower layer to a higher one, i.e. pointing upwards
    against the layering, is marked as a violation  */
export const render = async (graph: Graph, config: Config, level: LevelContext = {}): Promise<Layout> => {
    /*  ensure the graph carries no containers, as the bands are the
        only nesting of a layered diagram  */
    const nodes = Array.from(graph.nodes.values())
    rejectContainers("layer", nodes, level)

    /*  determine the layers in the order of their first appearance, with
        the layers of a cluster kept together (at the position of the first
        appearance of the cluster, on every nesting level), and lay out
        every layer as one explicitly ordered row of a "graph"  */
    const pathOf = new Map<string, string[]>()
    for (const node of nodes) {
        const layer = layerOf(node)
        if (layer === undefined)
            continue
        const path = pathOf.get(layer)
        const own  = clusterOf(node) ?? []
        if (path === undefined)
            pathOf.set(layer, own)
        else if (path.join("/") !== own.join("/")) {
            const show = (p: string[]) => p.length > 0 ? `cluster "${p.join("/")}"` : "no cluster"
            throw new Error(`node "${node.id}" places layer "${layer}" into ${show(own)}, ` +
                `unlike ${show(path)} of its other nodes`)
        }
    }
    type Tree = Map<string, Tree>
    const tree: Tree = new Map()
    for (const [ layer, path ] of pathOf) {
        let t = tree
        for (const name of path) {
            if (!t.has(`g:${name}`))
                t.set(`g:${name}`, new Map())
            t = t.get(`g:${name}`)!
        }
        t.set(`l:${layer}`, new Map())
    }
    const flat = (t: Tree): string[] =>
        Array.from(t).flatMap(([ key, sub ]) => key.startsWith("l:") ? [ key.slice(2) ] : flat(sub))
    const layers = flat(tree)
    const index   = new Map(layers.map((name, i) => [ name, i ]))
    const indexOf = (id: string): number | undefined => {
        const node = graph.nodes.get(id)
        const name = node !== undefined ? layerOf(node) : undefined
        return name !== undefined ? index.get(name) : undefined
    }
    const ordered: Graph = {
        nodes: new Map(nodes.map((node) => [ node.id, {
            ...node,
            attrs: [ ...node.attrs.filter((attr) => ![ "layer", "cluster", "order" ].includes(attr.key)),
                ...(layerOf(node) !== undefined ? [ { key: "order", val: String(index.get(layerOf(node)!)) } ] : []) ]
        } ])),
        edges: graph.edges
    }

    /*  an edge pointing from a lower layer to a higher one violates the
        layering (an edge within a layer or towards a lower one is fine),
        unless the marking of the violations is disabled  */
    const violates = (edge: Edge): boolean => {
        const [ s, t ] = [ indexOf(edge.source), indexOf(edge.target) ]
        return config["mark-violation"] && s !== undefined && t !== undefined && s > t
    }

    /*  count the self-loops of every node, as their detours rise above
        its box and have to stay within its band  */
    const loops = new Map<string, number>()
    for (const edge of graph.edges)
        if (edge.source === edge.target)
            loops.set(edge.source, (loops.get(edge.source) ?? 0) + 1)
    const rise = Math.max(0, ...Array.from(loops.values(), (cnt) => loopRise(cnt, config)))

    /*  lay out the graph uniformly (see "Uniform"), with the gutters
        holding at least the margins of the two bands beside them plus
        their gap (and the highest rise of the self-loops into the band
        below), even beyond the configured maximum gutter height  */
    const gutter = BAND_MARGIN * 2 + BAND_GAP + rise
    const cfg    = { ...config,
        "graph-gutter-height-min": Math.max(config["graph-gutter-height-min"], gutter),
        "graph-gutter-height-max": Math.max(config["graph-gutter-height-max"], gutter) }
    const layout = await renderGraph(ordered, cfg, level, { laneOf: (id) => indexOf(id) ?? -1, markOf: violates })

    /*  determine the vertical extent of every layer from its node boxes
        (and the self-loop detours above them)  */
    const pad    = config["group-box-padding"]
    const top    = layers.map(() => Infinity)
    const bottom = layers.map(() => -Infinity)
    for (const node of layout.nodes) {
        const i = indexOf(node.id)
        if (i === undefined)
            continue
        const h = layout.boxH.get(node.id)! / 2
        top[i]    = Math.min(top[i],    layout.cy(node.id) - h - loopRise(loops.get(node.id) ?? 0, config))
        bottom[i] = Math.max(bottom[i], layout.cy(node.id) + h)
    }

    /*  draw every layer as a band spanning the whole diagram, its nodes
        vertically centered by the same margin above and below them, with
        the layer name (optionally preceded by its number) left of its
        nodes in the bold font of the group tags, below the edges and the
        nodes  */
    const bounds   = boundsOf(layout)
    const numbered = config["layer-numbered"]
    const numberW  = numbered ? NUMBER_R * 2 + 12 : 0
    const labelW   = layers.reduce((w, name) => Math.max(w, textWidth(name, FS_GROUP, true)), 0) + numberW
    const left     = bounds.minX - pad - labelW - pad
    const right    = bounds.maxX + pad
    const shapes: Shape[] = []
    const y1Of = (i: number) => top[i]    - BAND_MARGIN
    const y2Of = (i: number) => bottom[i] + BAND_MARGIN
    layers.forEach((name, i) => {
        const [ y1, y2 ] = [ y1Of(i), y2Of(i) ]
        const mid = (y1 + y2) / 2
        shapes.push(rectShape(left, y1, right - left, y2 - y1, "color-container-border", 2,
            undefined, "color-container-box", 12))
        if (numbered) {
            /*  count the layers bottom-up, as every layer builds on the ones below it  */
            const fs = config["size-font-type"]
            const nr = String(layers.length - i)
            shapes.push(rectShape(left + pad, mid - NUMBER_R, NUMBER_R * 2, NUMBER_R * 2, "color-container-name", 2,
                undefined, "color-container-box", NUMBER_R))
            shapes.push(textShape(left + pad + NUMBER_R, mid, nr, "middle", textWidth(nr, fs, true),
                "color-container-name", "size-font-type", fs, { bold: true, halo: false }))
        }
        shapes.push(textShape(left + pad + numberW, mid, name, "start", textWidth(name, FS_GROUP, true),
            "color-container-name", FS_GROUP, FS_GROUP, { bold: true, halo: false }))
    })

    /*  draw every cluster of layers as a column left of the bands, nested
        clusters further right, spanning the bands of its layers, with its
        name running upwards (shrunk to fit a column of few bands, but at
        most to 60% of its font, beyond which the name is cut off with an
        ellipsis instead)  */
    const depth = layers.reduce((d, layer) => Math.max(d, pathOf.get(layer)!.length), 0)
    for (let k = 0; k < depth; k++) {
        const x = left - (depth - k) * (CLUSTER_W + CLUSTER_GAP)
        let start = 0
        while (start < layers.length) {
            const path = pathOf.get(layers[start])!
            if (path.length <= k) {
                start++
                continue
            }
            const key = path.slice(0, k + 1).join("/")
            let end = start
            while (end + 1 < layers.length && pathOf.get(layers[end + 1])!.slice(0, k + 1).join("/") === key)
                end++
            const [ y1, y2 ] = [ y1Of(start), y2Of(end) ]
            const room = y2 - y1 - 2 * CLUSTER_PAD
            const fs   = Math.max(Math.min(FS_GROUP, room / Math.max(textWidth(path[k], 1, true), 1)),
                Math.round(FS_GROUP * 0.6))
            let label  = path[k]
            while (label.length > 1 && textWidth(label, fs, true) > room)
                label = `${label.slice(0, -2)}…`
            shapes.push(rectShape(x, y1, CLUSTER_W, y2 - y1, "color-container-border", 2,
                undefined, "color-container-box", 12))
            shapes.push(textShape(x + CLUSTER_W / 2, (y1 + y2) / 2, label, "middle", textWidth(label, fs, true),
                "color-container-name", fs, fs, { bold: true, halo: false, upright: true }))
            start = end + 1
        }
    }

    /*  hand over the laid out graph with the bands and the violations  */
    const marked = layout.edges.map((edge) => violates(edge))
    return { ...layout, shapes, marked }
}
