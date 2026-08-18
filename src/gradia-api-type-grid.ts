/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Graph }        from "./gradia-api-model.js"
import { Config }       from "./gradia-api-config.js"
import { measureNodes } from "./gradia-api-render-node.js"
import { Layout }       from "./gradia-api-render-svg.js"

/*  lay out an edge-less graph model as a compact grid of tiles  */
export const render = async (graph: Graph, config: Config): Promise<Layout> => {
    const nodes = Array.from(graph.nodes.values())

    /*  resolve the configurable rendering geometry  */
    const margin  = config["size-canvas-margin"]
    const gapH    = config["grid-gap-horizontal"]
    const gapV    = config["grid-gap-vertical"]
    const maxCols = Math.max(Math.floor(config["grid-columns-max"]), 1)

    /*  ensure the graph is completely edge-less  */
    if (graph.edges.length > 0) {
        const edge = graph.edges[0]
        throw new Error("diagram type \"grid\" does not support edges " +
            `(found ${graph.edges.length}, first is "${edge.source}" --> "${edge.target}")`)
    }

    /*  determine node box sizes (keeping the individual widths)
        and unify only their heights into a single tile height  */
    const { boxW, boxH, contentH } = measureNodes(nodes, config,
        () => config["size-node-height-scale"] / 2)
    const tileH = nodes.reduce((a, node) => Math.max(a, boxH.get(node.id)!), 0)
    for (const node of nodes)
        boxH.set(node.id, tileH)

    /*  place the nodes in declaration order onto a roughly square,
        row-major grid (capped at the configured maximum of columns, so
        larger graphs grow only in height), with each column as wide as
        its widest tile and each tile left-aligned within its column  */
    const cols     = Math.max(Math.min(Math.ceil(Math.sqrt(nodes.length)), maxCols), 1)
    const colWidth = Array.from({ length: cols }, () => 0)
    nodes.forEach((node, i) => {
        colWidth[i % cols] = Math.max(colWidth[i % cols], boxW.get(node.id)!)
    })
    const colLX: number[] = []
    let x = margin
    for (let c = 0; c < cols; c++) {
        colLX.push(x)
        x += colWidth[c] + gapH
    }
    const nodeCX = new Map<string, number>()
    const nodeCY = new Map<string, number>()
    nodes.forEach((node, i) => {
        nodeCX.set(node.id, colLX[i % cols] + boxW.get(node.id)! / 2)
        nodeCY.set(node.id, margin + Math.floor(i / cols) * (tileH + gapV) + tileH / 2)
    })
    const cx = (id: string) => nodeCX.get(id)!
    const cy = (id: string) => nodeCY.get(id)!

    /*  hand over the laid out graph for SVG rendering  */
    return { nodes, edges: [], cx, cy, boxW, boxH, contentH, polys: [] }
}

