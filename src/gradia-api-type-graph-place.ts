/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Edge }                        from "./gradia-api-model.js"
import { GateSide }                          from "./gradia-api-render-container.js"

/*  grid clustering constants  */
const CLUSTX          = 26  /*  max X distance within a grid column         */
export const CLUSTY   = 72  /*  max Y distance within a grid row            */

/*  snap raw node positions onto a discrete grid by clustering the
    distinct X coordinates into columns and Y coordinates into rows  */
export const snapToGrid = (
    nodes: Node[],
    rawX:  Map<string, number>,
    rawY:  Map<string, number>
): { col: Map<string, number>, row: Map<string, number>, ncols: number, nrows: number } => {
    /*  cluster the distinct values into representatives more than a threshold apart  */
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

    /*  determine the index of the representative nearest to a value  */
    const nearestIndexOf = (reps: number[], v: number): number => {
        let best = 0
        for (let i = 1; i < reps.length; i++)
            if (Math.abs(reps[i] - v) < Math.abs(reps[best] - v))
                best = i
        return best
    }

    /*  assign every node to its nearest column  */
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
export const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
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
export const refineRows = (
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
    topmost free cell of its column (unless packed columns keep them
    below the connected ones), then merge every row into the row
    above it as long as no column is occupied in both (which keeps the
    vertical order of all nodes and the row alignment of the nodes
    sharing a row), and finally renumber the rows densely  */
export const compactRows = (
    nodes: Node[],
    edges: Edge[],
    col:   Map<string, number>,
    row:   Map<string, number>,
    lift:  boolean
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
    const isolated = !lift ? [] : nodes.filter((node) => !linked.has(node.id))
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
export const placeGates = (
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

