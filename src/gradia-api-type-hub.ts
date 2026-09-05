/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Edge, Graph }                       from "./gradia-api-model.js"
import { Config }                                  from "./gradia-api-config.js"
import { Poly, NodeStyle }                         from "./gradia-api-render-base.js"
import { isPrimary, measureNodes, defaultStyleOf } from "./gradia-api-render-node.js"
import { Layout }                                  from "./gradia-api-render-svg.js"
import { LevelContext }                            from "./gradia-api-render-container.js"
import { Side, TrackUser, simplifyPoly, assignPorts, assignTracks } from "./gradia-api-render-edge.js"

/*  the separator between a node id and its placement suffix,
    distinguishing the two clones of a twice-placed node  */
const CLONE = "\u0000"

/*  validate the constrained input topology and classify the declared
    nodes: exactly one node is annotated with "primary: true" and every
    edge connects the primary with another node. Each other node is
    classified as input (edges point toward the primary) and/or output
    (edges originate from the primary); a node referenced in both
    directions is placed twice, once in the input column and once in
    the output column, with its edges rewritten to attach to the
    corresponding placement  */
const classifyTopology = (graph: Graph): {
    center: Node, inputs: Node[], outputs: Node[], nodes: Node[], edges: Edge[]
} => {
    const declared  = Array.from(graph.nodes.values())
    for (const node of declared)
        if (node.id.includes(CLONE))
            throw new Error(`node id ${JSON.stringify(node.id)} contains a reserved control character`)
    const primaries = declared.filter(isPrimary)
    if (primaries.length !== 1)
        throw new Error(`expected exactly one node annotated with "primary: true" (found ${primaries.length})`)
    const center = primaries[0]
    const inSet  = new Set<string>()
    const outSet = new Set<string>()
    for (const edge of graph.edges) {
        if (edge.source === center.id && edge.target === center.id)
            throw new Error(`self-loop on primary node "${center.id}" not supported`)
        else if (edge.target === center.id)
            inSet.add(edge.source)
        else if (edge.source === center.id)
            outSet.add(edge.target)
        else
            throw new Error(`edge "${edge.source}" --> "${edge.target}" does not connect to primary node "${center.id}"`)
    }

    /*  classify every non-primary node into the input and/or output column  */
    const dual = new Set<string>()
    const inputs:  Node[] = []
    const outputs: Node[] = []
    for (const node of declared) {
        if (node.id === center.id)
            continue
        const isInput  = inSet.has(node.id)
        const isOutput = outSet.has(node.id)
        if (!isInput && !isOutput)
            throw new Error(`node "${node.id}" is neither input nor output of primary node "${center.id}"`)
        if (isInput && isOutput) {
            dual.add(node.id)
            inputs.push({  ...node, id: node.id + CLONE + "in"  })
            outputs.push({ ...node, id: node.id + CLONE + "out" })
        }
        else if (isInput)
            inputs.push(node)
        else
            outputs.push(node)
    }

    /*  rewrite the edges of the twice-placed nodes onto their clones  */
    const edges = graph.edges.map((edge) => {
        if (edge.target === center.id && dual.has(edge.source))
            return { ...edge, source: edge.source + CLONE + "in" }
        else if (edge.source === center.id && dual.has(edge.target))
            return { ...edge, target: edge.target + CLONE + "out" }
        else
            return edge
    })
    return { center, inputs, outputs, nodes: [ center, ...inputs, ...outputs ], edges }
}

/*  lay out a hub graph model (N input nodes, one central hub node, M
    output nodes), for a containment level with the container placeholders
    at their fixed sizes and the edge ends attaching to them at their
    fixed ports  */
export const render = async (graph: Graph, config: Config, level: LevelContext = {}): Promise<Layout> => {
    /*  validate the constrained input topology and classify the
        declared nodes into the input and output columns  */
    const { center, inputs, outputs, nodes, edges } = classifyTopology(graph)
    const inputSet = new Set(inputs.map((node) => node.id))

    /*  resolve the configurable rendering geometry  */
    const margin = config["size-canvas-margin"]
    const gap    = config["hub-node-gap"]
    const scale  = config["size-node-height-scale"]

    /*  the fixed three-column layout assignment  */
    const colOf = (id: string): number =>
        id === center.id ? 1 : (inputSet.has(id) ? 0 : 2)

    /*  determine the attachment sides of every edge (east/west),
        derived from the column relation of its endpoint nodes  */
    const sides: { s: Side, t: Side }[] = edges.map((edge) =>
        colOf(edge.source) < colOf(edge.target) ? { s: "e", t: "w" } : { s: "w", t: "e" })

    /*  determine node box sizes from their textual content (all boxes at
        half height scale), then grow every box whose edge attachments
        exceed the configured per-side maximum, step-wise by one port
        separation per additional edge, so the edges keep enough
        attachment room without a fixed height increase (the fixed-size
        boxes of a containment level are exempt)  */
    const { boxW, boxH, contentH } = measureNodes(nodes, config, () => scale / 2, level.fixedSize)
    const portCnt = new Map<string, number>()
    edges.forEach((edge, i) => {
        portCnt.set(`${sides[i].s}:${edge.source}`, (portCnt.get(`${sides[i].s}:${edge.source}`) ?? 0) + 1)
        portCnt.set(`${sides[i].t}:${edge.target}`, (portCnt.get(`${sides[i].t}:${edge.target}`) ?? 0) + 1)
    })
    for (const node of nodes) {
        if (level.fixedSize?.has(node.id))
            continue
        const cnt = Math.max(portCnt.get(`w:${node.id}`) ?? 0, portCnt.get(`e:${node.id}`) ?? 0)
        if (cnt > config["hub-node-degree-max"])
            boxH.set(node.id, boxH.get(node.id)! +
                (cnt - config["hub-node-degree-max"]) * config["size-edge-port-gap"])
    }

    /*  fixed three-column layout: stack the input nodes in the first
        column and the output nodes in the third column (each stack
        vertically centered), and place the center node in the second
        column at the vertical center of the canvas  */
    const stackH = (list: Node[]): number =>
        list.reduce((a, node) => a + boxH.get(node.id)!, 0) + Math.max(list.length - 1, 0) * gap
    const totalH = Math.max(stackH(inputs), boxH.get(center.id)!, stackH(outputs))
    const nodeCY = new Map<string, number>()
    const stack  = (list: Node[]): void => {
        let y = margin + (totalH - stackH(list)) / 2
        for (const node of list) {
            nodeCY.set(node.id, y + boxH.get(node.id)! / 2)
            y += boxH.get(node.id)! + gap
        }
    }
    stack(inputs)
    stack(outputs)
    nodeCY.set(center.id, margin + totalH / 2)

    /*  determine column widths and left edge positions, with the two
        inter-column channel widths sized by actual edge usage  */
    const colWidth = [
        inputs.reduce((a, node)  => Math.max(a, boxW.get(node.id)!), 0),
        boxW.get(center.id)!,
        outputs.reduce((a, node) => Math.max(a, boxW.get(node.id)!), 0)
    ]
    const chanOf   = (edge: Edge): number =>
        Math.min(colOf(edge.source), colOf(edge.target))
    const chanCnt  = [
        edges.filter((edge) => chanOf(edge) === 0).length,
        edges.filter((edge) => chanOf(edge) === 1).length
    ]
    const chanW    = chanCnt.map((cnt) =>
        Math.min(config["hub-channel-width-max"], Math.max(config["hub-channel-width-min"],
            28 + (cnt - 1) * config["size-edge-track-gap"])))
    const colLX: number[] = []
    let x = margin
    for (let c = 0; c < 3; c++) {
        colLX.push(x)
        x += colWidth[c] + (c < 2 ? chanW[c] : 0)
    }

    /*  place the nodes within their column: input nodes right-aligned,
        output nodes left-aligned, and the center node centered  */
    const cx = (id: string): number => {
        const c = colOf(id)
        if (c === 0)
            return colLX[0] + colWidth[0] - boxW.get(id)! / 2
        else if (c === 2)
            return colLX[2] + boxW.get(id)! / 2
        else
            return colLX[1] + colWidth[1] / 2
    }
    const cy = (id: string): number => nodeCY.get(id)!

    /*  distribute the edge attachment ports along each node side  */
    const portPos = assignPorts(edges, sides, cx, cy, boxW, boxH, config["size-edge-port-gap"],
        undefined, level.fixedPort)

    /*  assign the vertical tracks within each channel (see assignTracks
        for the crossing-avoiding ordering scheme; a hub graph has no backward
        edges, hence no channel user is ever mirrored)  */
    const chanUsers: TrackUser[][] = [ [], [] ]
    edges.forEach((edge, i) => {
        chanUsers[chanOf(edge)].push({
            edge:   i,
            posIn:  portPos.get(`${i}:s`)!.y,
            posOut: portPos.get(`${i}:t`)!.y,
            mirror: false
        })
    })
    const chanOff = new Map<string, number>()
    chanUsers.forEach((users, c) => {
        for (const [ edge, off ] of assignTracks(users, chanW[c], 16, config["size-edge-track-gap"]))
            chanOff.set(`${c}:${edge}`, off)
    })

    /*  determine the X position of an edge's assigned track within a channel  */
    const chanX = (c: number, edge: number): number => colLX[c] + colWidth[c] + chanW[c] / 2 +
        chanOff.get(`${c}:${edge}`)!

    /*  route every edge as an orthogonal polyline through its channel  */
    const polys = edges.map((edge, i) => {
        const sp = portPos.get(`${i}:s`)!
        const tp = portPos.get(`${i}:t`)!
        const ch = chanX(chanOf(edge), i)
        let pts: Poly
        if (sp.y === tp.y)
            pts = [ [ sp.x, sp.y ], [ tp.x, tp.y ] ]
        else
            pts = [ [ sp.x, sp.y ], [ ch, sp.y ], [ ch, tp.y ], [ tp.x, tp.y ] ]
        return simplifyPoly(pts)
    })

    /*  hand over the laid out graph for SVG rendering (the output copy
        of a twice-placed node is rendered as a dashed grey "ghost" box,
        all other boxes get the default primary/regular coloring)  */
    const styleOf = (node: Node): NodeStyle =>
        node.id.endsWith(CLONE + "out") ? {
            fill:   "color-node-ghost-box",
            stroke: "color-node-ghost-border",
            text:   "color-node-ghost-name",
            dash:   "10 6"
        } : defaultStyleOf(node)
    return { nodes, edges, cx, cy, boxW, boxH, contentH, polys, styleOf }
}

