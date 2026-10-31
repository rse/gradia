/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Graph }              from "./gradia-api-model.js"
import { Config }                   from "./gradia-api-config.js"
import { Layout, textWidth }        from "./gradia-api-render-base.js"
import { Shape, textShape, rectShape, badgeShape }
    from "./gradia-api-render-shape.js"
import { LevelContext, rejectContainers }
    from "./gradia-api-render-container.js"
import { defaultStyleOf, urlOf, orderOf, typeOf, badgeOf, clusterOf, BADGE_R }
    from "./gradia-api-render-node.js"

/*  the geometry of the cells, the headers, and the cluster bands  */
const CELL      = 44   /*  width and height of a cell                  */
const HEAD_PAD  = 12   /*  padding inside a header along its label     */
const HEAD_GAP  = 8    /*  gap between the headers and the cells       */
const BAND      = 36   /*  thickness of a cluster band                 */
const BAND_PAD  = 4    /*  padding along the name in a cluster band    */
const BADGE_GAP = 12   /*  gap between a header label and its badge    */

/*  determine the cycles of a graph: every node reaching itself through
    its edges, mapped onto the index of the first node of its strongly
    connected component (the nodes reaching each other)  */
const cyclesOf = (ids: string[], edges: { source: string, target: string }[]): Map<string, number> => {
    const succ = new Map<string, string[]>(ids.map((id) => [ id, [] ]))
    for (const edge of edges)
        succ.get(edge.source)!.push(edge.target)
    const reach = new Map(ids.map((id) => {
        const seen = new Set<string>()
        const todo = [ ...succ.get(id)! ]
        for (let v = todo.pop(); v !== undefined; v = todo.pop()) {
            if (!seen.has(v)) {
                seen.add(v)
                todo.push(...succ.get(v)!)
            }
        }
        return [ id, seen ]
    }))
    const cycles = new Map<string, number>()
    ids.forEach((id, k) => {
        if (reach.get(id)!.has(id) && !cycles.has(id))
            for (const other of ids)
                if (reach.get(id)!.has(other) && reach.get(other)!.has(id))
                    cycles.set(other, k)
    })
    return cycles
}

/*  order nodes topologically: the sources of the edges before their
    targets, every unit (a cycle, or else a single node) as a whole, its
    members in their given order, and the rank of the units deciding
    among the ones independent of each other (Kahn's algorithm on the
    units, always taking the ready one of the lowest rank)  */
const topoOrder = (ids: string[], edges: { source: string, target: string }[],
    unitOf: (id: string) => number): string[] => {
    const members = new Map<number, string[]>()
    for (const id of ids)
        members.set(unitOf(id), [ ...(members.get(unitOf(id)) ?? []), id ])
    const succ  = new Map<number, Set<number>>()
    const indeg = new Map(Array.from(members.keys(), (unit) => [ unit, 0 ]))
    for (const edge of edges) {
        const [ a, b ] = [ unitOf(edge.source), unitOf(edge.target) ]
        if (a === b || succ.get(a)?.has(b) === true)
            continue
        succ.set(a, (succ.get(a) ?? new Set<number>()).add(b))
        indeg.set(b, indeg.get(b)! + 1)
    }
    const order: string[] = []
    const ready = Array.from(indeg).filter(([ , deg ]) => deg === 0).map(([ unit ]) => unit)
    while (ready.length > 0) {
        ready.sort((a, b) => a - b)
        const unit = ready.shift()!
        order.push(...members.get(unit)!)
        for (const next of succ.get(unit) ?? []) {
            indeg.set(next, indeg.get(next)! - 1)
            if (indeg.get(next) === 0)
                ready.push(next)
        }
    }
    return order
}

/*  lay out a graph model as a dependency structure matrix (DSM): the
    nodes are both its rows and its columns (partitioned by their clusters,
    and the members of a cycle moved together, so every cluster and every
    cycle forms a block on the diagonal), and the cell of row X and
    column Y counts the edges from X to Y  */
export const render = async (graph: Graph, config: Config, level: LevelContext = {}): Promise<Layout> => {
    /*  ensure the graph carries no containers, as the rows are flat  */
    const declared = Array.from(graph.nodes.values())
    rejectContainers("matrix", declared, level)

    /*  determine the rows and columns: both are the nodes, partitioned
        into their clusters (in order of first appearance, the nodes
        without one in the implied cluster "default", and a "/"-separated
        cluster path nesting sub-clusters, kept together within their
        cluster), and within every cluster either in the explicit order of
        their "order" attributes (the nodes without one trailing), or else
        in topological order, so all entries of a cluster lie above the
        diagonal, except the ones of its cycles, whose members are
        consecutive in both cases  */
    const ordered   = declared.some((node) => orderOf(node) !== undefined)
    const sorted    = ordered ?
        declared.slice().sort((a, b) => (orderOf(a) ?? Infinity) - (orderOf(b) ?? Infinity) || 0) : declared
    const index     = new Map(sorted.map((node, i) => [ node.id, i ]))
    const cycles    = cyclesOf(sorted.map((node) => node.id), graph.edges)
    const unitOf    = (id: string) => cycles.get(id) ?? index.get(id)!
    const clustered = declared.some((node) => clusterOf(node) !== undefined)
    const pathOf    = (node: Node): string[] => {
        if (!clustered)
            return []
        const path = clusterOf(node) ?? []
        return path.length > 0 ? path : [ "default" ]
    }
    const nameOf  = (node: Node) => pathOf(node).join("/")
    type Tree = Map<string, Tree>
    const tree: Tree = new Map()
    for (const node of sorted) {
        let t = tree
        for (const name of pathOf(node)) {
            if (!t.has(`g:${name}`))
                t.set(`g:${name}`, new Map())
            t = t.get(`g:${name}`)!
        }
        if (!t.has(`l:${nameOf(node)}`))
            t.set(`l:${nameOf(node)}`, new Map())
    }
    const flat = (t: Tree): string[] =>
        Array.from(t).flatMap(([ key, sub ]) => key.startsWith("l:") ? [ key.slice(2) ] : flat(sub))
    const nodes: Node[] = []
    const parts: { path: string[], from: number, to: number }[] = []
    for (const name of flat(tree)) {
        const members = sorted.filter((node) => nameOf(node) === name)
        const inside  = new Set(members.map((node) => node.id))
        const list    = ordered ?
            members.slice().sort((a, b) => unitOf(a.id) - unitOf(b.id) || index.get(a.id)! - index.get(b.id)!) :
            topoOrder(members.map((node) => node.id),
                graph.edges.filter((edge) => inside.has(edge.source) && inside.has(edge.target)), unitOf)
                .map((id) => graph.nodes.get(id)!)
        parts.push({ path: pathOf(members[0]), from: nodes.length, to: nodes.length + list.length })
        nodes.push(...list)
    }

    /*  the clusters on every nesting level: the runs of consecutive parts
        sharing the cluster path up to that level  */
    const depth    = parts.reduce((d, part) => Math.max(d, part.path.length), 0)
    const clusters: { level: number, name: string, from: number, to: number }[] = []
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
            clusters.push({ level: k, name: parts[i].path[k], from: parts[i].from, to: parts[j].to })
            i = j + 1
        }
    }
    const rows   = nodes
    const cols   = nodes
    const rowOf  = new Map(rows.map((node, i) => [ node.id, i ]))
    const colOf  = new Map(cols.map((node, i) => [ node.id, i ]))

    /*  count the edges of every cell (summing the numeric arities, as a
        derived edge may stand for several references)  */
    const counts = new Map<number, number>()
    const cellOf = (r: number, c: number) => r * cols.length + c
    for (const edge of graph.edges) {
        const [ r, c ] = [ rowOf.get(edge.source)!, colOf.get(edge.target)! ]
        const arity = edge.arity !== undefined && /^\d+$/.test(edge.arity) ? Number(edge.arity) : 1
        counts.set(cellOf(r, c), (counts.get(cellOf(r, c)) ?? 0) + arity)
    }

    /*  resolve the configurable rendering geometry (with the cluster bands
        left of the row headers and above the column headers)  */
    const margin = config["size-canvas-margin"]
    const fsName = config["size-font-prop"]
    const fsNum  = config["size-font-type"]
    const band   = depth * (BAND + HEAD_GAP)
    const headOf = (list: Node[]) =>
        Math.ceil(list.reduce((w, node) => Math.max(w, textWidth(node.name, fsName, true) +
            (badgeOf(node) !== undefined ? BADGE_GAP + BADGE_R * 2 : 0)), 0) + HEAD_PAD * 2)

    /*  the titles of the rows and the columns: the type shared by all of
        their nodes, if any  */
    const titleOf = (list: Node[]): string | undefined => {
        const [ type, ...more ] = new Set(list.map((node) => typeOf(node)))
        return more.length === 0 && type !== undefined && type !== "" ? type : undefined
    }
    const rowTitle = titleOf(rows)
    const colTitle = titleOf(cols)
    const titleW   = Math.max(textWidth(rowTitle ?? "", fsNum, true), textWidth(colTitle ?? "", fsNum, true))
    const rowW   = Math.max(headOf(rows), Math.ceil(titleW + HEAD_PAD * 2))
    const colH   = Math.max(headOf(cols), Math.ceil(fsNum * 4))
    const hx     = margin + band
    const hy     = margin + band
    const x0     = hx + rowW + HEAD_GAP
    const y0     = hy + colH + HEAD_GAP

    /*  generate the shapes: the column headers (upright boxes, the node
        labels running upwards) and the row headers (the very same boxes
        lying), both in the colors of the node boxes, and the cells  */
    const shapes: Shape[] = []
    const header = (node: Node, x: number, y: number, w: number, h: number, upright: boolean) => {
        const style = defaultStyleOf(node)
        shapes.push(rectShape(x, y, w, h, style.stroke, 2, undefined, style.fill, 6))
        const [ tx, ty ] = upright ? [ x + CELL / 2, y + h - HEAD_PAD ] : [ x + HEAD_PAD, y + CELL / 2 ]
        shapes.push(textShape(tx, ty, node.name, "start", textWidth(node.name, fsName, true), style.text,
            "size-font-prop", fsName, { bold: true, url: urlOf(node), halo: false, upright }))

        /*  the optional badge, centered at the end of the box the label
            runs towards (see "headOf" for the room reserved for it)  */
        const badge = badgeOf(node)
        if (badge !== undefined)
            shapes.push(upright ?
                badgeShape(x + w / 2, y + HEAD_PAD + BADGE_R, BADGE_R, badge, style) :
                badgeShape(x + w - HEAD_PAD - BADGE_R, y + h / 2, BADGE_R, badge, style))
    }
    cols.forEach((node, c) => header(node, x0 + c * CELL, hy, CELL, colH, true))
    rows.forEach((node, r) => header(node, hx, y0 + r * CELL, rowW, CELL, false))

    /*  the cluster bands: one spanning the rows of a cluster left of their
        headers (its name running upwards) and one spanning its columns
        above their headers (the outermost clusters furthest out), both in
        the colors of the group boxes (the name in the regular font of the
        numbers, shrunk to fit a band of few cells, but at most to 70% of
        that font, beyond which the name is cut off with an ellipsis)  */
    for (const { level, name, from, to } of clusters) {
        const off  = margin + level * (BAND + HEAD_GAP)
        const span = (to - from) * CELL
        const room = span - 2 * BAND_PAD
        const fs   = Math.max(Math.min(fsNum, room / Math.max(textWidth(name, 1), 1)), Math.round(fsNum * 0.7))
        let label  = name
        while (label.length > 1 && textWidth(label, fs) > room)
            label = `${label.slice(0, -2)}…`
        const w    = textWidth(label, fs)
        shapes.push(rectShape(off, y0 + from * CELL, BAND, span, "color-group-border", 2, undefined,
            "color-group-box", 6))
        shapes.push(textShape(off + BAND / 2, y0 + from * CELL + span / 2, label, "middle", w,
            "color-group-name", fs, fs, { halo: false, upright: true }))
        shapes.push(rectShape(x0 + from * CELL, off, span, BAND, "color-group-border", 2, undefined,
            "color-group-box", 6))
        shapes.push(textShape(x0 + from * CELL + span / 2, off + BAND / 2, label, "middle", w,
            "color-group-name", fs, fs, { halo: false }))
    }

    /*  the titles of the rows and the columns in the corner  */
    if (rowTitle !== undefined)
        shapes.push(textShape(hx + HEAD_PAD, hy + colH - HEAD_PAD - fsNum * 0.35, rowTitle, "start",
            textWidth(rowTitle, fsNum, true), "color-container-name", "size-font-type", fsNum, { bold: true, halo: false }))
    if (colTitle !== undefined)
        shapes.push(textShape(hx + rowW - HEAD_PAD, hy + HEAD_PAD + fsNum * 0.65, colTitle, "end",
            textWidth(colTitle, fsNum, true), "color-container-name", "size-font-type", fsNum, { bold: true, halo: false }))

    /*  the cells: the diagonal shaded, the cells with an entry in the
        node box color, the numbers of the edges closing a cycle (the edges
        within a cycle pointing back to an earlier or the same node, i.e.,
        on or below the diagonal) in the violation color, a number too
        wide for its cell in a smaller font  */
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols.length; c++) {
            const [ x, y ] = [ x0 + c * CELL, y0 + r * CELL ]
            const count    = counts.get(cellOf(r, c))
            const k        = cycles.get(rows[r].id)
            const feedback = count !== undefined && k !== undefined && k === cycles.get(cols[c].id) && c <= r
            shapes.push(rectShape(x, y, CELL, CELL, "color-container-border", 1, undefined,
                r === c ? "color-node-self-box" : count !== undefined ? "color-node-regular-box" : "color-container-box"))
            if (count !== undefined) {
                const num = String(count)
                const fs  = Math.min(fsNum, (CELL - 8) / textWidth(num, 1, true))
                shapes.push(textShape(x + CELL / 2, y + CELL / 2, num, "middle", textWidth(num, fs, true),
                    feedback ? "color-mark-violation" : "color-node-regular-name",
                    fs < fsNum ? fs : "size-font-type", fs, { bold: true, halo: false }))
            }
        }
    }

    /*  outline every cluster (on every nesting level) as a block on the
        diagonal, so a cluster encloses the blocks of its sub-clusters  */
    for (const { from, to } of clusters)
        shapes.push(rectShape(x0 + from * CELL, y0 + from * CELL, (to - from) * CELL, (to - from) * CELL,
            "color-group-name", 3))

    /*  outline every cycle as a dashed block on the diagonal, one per run
        of its consecutive members within a cluster (a cycle spanning several
        clusters is split by them), except a single member split off from
        the rest of its cycle (a run of one is outlined only for a cycle of
        one, i.e., a self-loop), as only its counts mark it  */
    const runs: number[][] = []
    nodes.forEach((node, i) => {
        const k    = cycles.get(node.id)
        const last = runs.at(-1)
        if (k === undefined)
            return
        if (last !== undefined && last.at(-1) === i - 1 && cycles.get(nodes[i - 1].id) === k
            && nameOf(nodes[i - 1]) === nameOf(node))
            last.push(i)
        else
            runs.push([ i ])
    })
    const sizeOf = (k: number) => nodes.filter((node) => cycles.get(node.id) === k).length
    for (const members of runs) {
        if (members.length === 1 && sizeOf(cycles.get(nodes[members[0]].id)!) > 1)
            continue
        const [ x, y ] = [ x0 + members[0] * CELL, y0 + members[0] * CELL ]
        const size     = members.length * CELL
        shapes.push(rectShape(x, y, size, size, "color-mark-violation", 3, "10 6"))
    }

    /*  hand over the shapes for SVG rendering (no node boxes and edges)  */
    return { nodes: [], edges: [], cx: () => 0, cy: () => 0,
        boxW: new Map(), boxH: new Map(), contentH: new Map(), polys: [], shapes }
}
