/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Graph }      from "./gradia-api-model.js"
import { textWidth }        from "./gradia-api-render-base.js"
import { clusterOf }        from "./gradia-api-render-node.js"

/*  a consecutive part of the ordered items (from inclusive, to
    exclusive) sharing one cluster path, and a cluster on a nesting
    level, spanning the parts of its run  */
export interface ClusterPart { path: string[], from: number, to: number }
export interface ClusterRun  { level: number, name: string, from: number, to: number }

/*  order the given items, each named and placed into a cluster path, in
    the order of their first appearance, with the items of a cluster kept
    together (at the position of the first appearance of the cluster, on
    every nesting level)  */
export const clusterOrder = (items: Iterable<[ string, string[] ]>): string[] => {
    type Tree = Map<string, Tree>
    const tree: Tree = new Map()
    for (const [ item, path ] of items) {
        let t = tree
        for (const name of path) {
            if (!t.has(`g:${name}`))
                t.set(`g:${name}`, new Map())
            t = t.get(`g:${name}`)!
        }
        if (!t.has(`l:${item}`))
            t.set(`l:${item}`, new Map())
    }
    const flat = (t: Tree): string[] =>
        Array.from(t).flatMap(([ key, sub ]) => key.startsWith("l:") ? [ key.slice(2) ] : flat(sub))
    return flat(tree)
}

/*  the clusters on every nesting level: the runs of consecutive parts
    sharing the cluster path up to that level (with the nesting depth)  */
export const clusterRuns = (parts: ClusterPart[]): { depth: number, runs: ClusterRun[] } => {
    const depth = parts.reduce((d, part) => Math.max(d, part.path.length), 0)
    const runs: ClusterRun[] = []
    for (let k = 0; k < depth; k++) {
        for (let i = 0; i < parts.length;) {
            if (parts[i].path.length <= k) {
                i++
                continue
            }
            const key = parts[i].path.slice(0, k + 1).join("/")
            let j = i
            while (j + 1 < parts.length && parts[j + 1].path.slice(0, k + 1).join("/") === key)
                j++
            runs.push({ level: k, name: parts[i].path[k], from: parts[i].from, to: parts[j].to })
            i = j + 1
        }
    }
    return { depth, runs }
}

/*  shrink a name to fit the given room, starting from the given font
    size (but at most to the given fraction of it, beyond which the name
    is cut off with an ellipsis instead), with its resulting font size
    and width  */
export interface FitLabel { label: string, fs: number, w: number }
export const fitLabel = (name: string, room: number, base: number, floor: number, bold = false): FitLabel => {
    const fs  = Math.max(Math.min(base, room / Math.max(textWidth(name, 1, bold), 1)), Math.round(base * floor))
    let label = name
    while (label.length > 1 && textWidth(label, fs, bold) > room)
        label = `${label.slice(0, -2)}…`
    return { label, fs, w: textWidth(label, fs, bold) }
}

/*  determine the bands of a "layer" or "slice" diagram, as named by the
    eponymous annotation of the nodes, in the order of their first
    appearance, with the bands of a cluster kept together, and the graph
    with every band laid out as one explicitly ordered lane  */
export const bandsOf = (graph: Graph, nodes: Node[], kind: "layer" | "slice") => {
    const bandOf = (node: Node): string | undefined =>
        node.attrs.findLast((attr) => attr.key === kind)?.val
    const pathOf = new Map<string, string[]>()
    for (const node of nodes) {
        const band = bandOf(node)
        if (band === undefined)
            continue
        const path = pathOf.get(band)
        const own  = clusterOf(node) ?? []
        if (path === undefined)
            pathOf.set(band, own)
        else if (path.join("/") !== own.join("/")) {
            const show = (p: string[]) => p.length > 0 ? `cluster "${p.join("/")}"` : "no cluster"
            throw new Error(`node "${node.id}" places ${kind} "${band}" into ${show(own)}, ` +
                `unlike ${show(path)} of its other nodes`)
        }
    }
    const names   = clusterOrder(pathOf)
    const index   = new Map(names.map((name, i) => [ name, i ]))
    const indexOf = (id: string): number | undefined => {
        const node = graph.nodes.get(id)
        const name = node !== undefined ? bandOf(node) : undefined
        return name !== undefined ? index.get(name) : undefined
    }
    const ordered: Graph = {
        nodes: new Map(nodes.map((node) => [ node.id, {
            ...node,
            attrs: [ ...node.attrs.filter((attr) => ![ kind, "cluster", "order" ].includes(attr.key)),
                ...(bandOf(node) !== undefined ? [ { key: "order", val: String(index.get(bandOf(node)!)) } ] : []) ]
        } ])),
        edges: graph.edges
    }

    /*  the bands as consecutive parts of their own, for their clusters  */
    const parts = names.map((name, i): ClusterPart => ({ path: pathOf.get(name)!, from: i, to: i + 1 }))
    return { names, indexOf, ordered, parts }
}

