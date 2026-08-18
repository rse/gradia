/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Graph }           from "./gradia-api-model.js"
import { Config }          from "./gradia-api-config.js"
import { SCALE_H, MARGIN } from "./gradia-api-render-base.js"
import { measureNodes }    from "./gradia-api-render-node.js"
import { Layout }          from "./gradia-api-render-svg.js"

/*  rendering geometry constants  */
const GAP_H   = 40   /*  horizontal gap between the tiles of the grid  */
const GAP_V   = 20   /*  vertical gap between the tiles of the grid    */
const MAXCOLS = 4    /*  max number of side-by-side tiles              */

/*  lay out an edge-less graph model as a compact grid of tiles  */
export const render = async (graph: Graph, _config: Config): Promise<Layout> => {
    const nodes = Array.from(graph.nodes.values())

    /*  ensure the graph is completely edge-less  */
    if (graph.edges.length > 0) {
        const edge = graph.edges[0]
        throw new Error("diagram type \"grid\" does not support edges " +
            `(found ${graph.edges.length}, first is "${edge.source}" --> "${edge.target}")`)
    }

    /*  determine node box sizes (keeping the individual widths)
        and unify only their heights into a single tile height  */
    const { boxW, boxH, contentH } = measureNodes(nodes, () => SCALE_H / 2)
    const tileH = nodes.reduce((a, node) => Math.max(a, boxH.get(node.id)!), 0)
    for (const node of nodes)
        boxH.set(node.id, tileH)

    /*  place the nodes in declaration order onto a roughly square,
        row-major grid (capped at MAXCOLS columns, so larger graphs
        grow only in height), with each column as wide as its widest
        tile and each tile left-aligned within its column  */
    const cols     = Math.max(Math.min(Math.ceil(Math.sqrt(nodes.length)), MAXCOLS), 1)
    const colWidth = Array.from({ length: cols }, () => 0)
    nodes.forEach((node, i) => {
        colWidth[i % cols] = Math.max(colWidth[i % cols], boxW.get(node.id)!)
    })
    const colLX: number[] = []
    let x = MARGIN
    for (let c = 0; c < cols; c++) {
        colLX.push(x)
        x += colWidth[c] + GAP_H
    }
    const nodeCX = new Map<string, number>()
    const nodeCY = new Map<string, number>()
    nodes.forEach((node, i) => {
        nodeCX.set(node.id, colLX[i % cols] + boxW.get(node.id)! / 2)
        nodeCY.set(node.id, MARGIN + Math.floor(i / cols) * (tileH + GAP_V) + tileH / 2)
    })
    const cx = (id: string) => nodeCX.get(id)!
    const cy = (id: string) => nodeCY.get(id)!

    /*  hand over the laid out graph for SVG rendering  */
    return { nodes, edges: [], cx, cy, boxW, boxH, contentH, polys: [] }
}

