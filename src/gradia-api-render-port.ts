/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Edge }             from "./gradia-api-model.js"
import { Config }           from "./gradia-api-config.js"
import { ARITY_PAD, ARROW_H, arityHeight }
    from "./gradia-api-render-base.js"

/*  edge attachment port geometry  */
export const PORT_PAD = 10  /*  padding of the port band inside the box  */

/*  the node side an edge attaches to (east, west, or north, the
    latter carrying the incoming ends of the self-loops only)  */
export type Side = "e" | "w" | "n"

/*  the separation of the adjacent ports of a node side: the configured
    one, raised to what the arity labels demand once any edge carries
    one, as such a label sits ARITY_PAD below the line of the port above
    it, whose arrow head reaches down by half its height, and needs two
    more ARITY_PAD of air between the two, so it stays attributable to
    its own arrow instead of drifting into the neighboring one, and
    likewise to what a name label demands on a node side holding a
    merged port of a named bundle, as the label then sits beside it, and
    on a node side a named edge runs into, as its name label sits beside
    the stub of its edge the same way, set back behind the arrow head  */
export const portGapOf = (edges: Edge[], sides: { s: Side, t: Side }[], config: Config,
    merged?: (edge: number, role: "s" | "t") => string | undefined): (id: string, side: Side) => number => {
    const gap    = edges.some((edge) => edge.arity !== undefined) ?
        Math.max(config["size-edge-port-gap"],
            Math.ceil(3 * ARITY_PAD + arityHeight(config) + ARROW_H / 2)) :
        config["size-edge-port-gap"]
    const named  = Math.max(gap, Math.ceil(3 * ARITY_PAD + config["size-font-edge"] + 4 + ARROW_H / 2))
    const raised = new Set<string>()
    if (merged !== undefined) {
        edges.forEach((edge, i) => {
            if (edge.name === undefined)
                return
            if (merged(i, "s") !== undefined)
                raised.add(`${edge.source}:${sides[i].s}`)
            if (merged(i, "t") !== undefined)
                raised.add(`${edge.target}:${sides[i].t}`)
        })
    }
    const arrival = Math.max(gap, 3 * ARITY_PAD + config["size-font-edge"] + 4)
    const arrived = new Set(edges.flatMap((edge, i) => edge.name !== undefined && edge.source !== edge.target ?
        [ `${edge.target}:${sides[i].t}` ] : []))
    return (id, side) => Math.max(raised.has(`${id}:${side}`) ? named : gap,
        arrived.has(`${id}:${side}`) ? arrival : gap)
}

/*  an edge endpoint (the source or the target of an edge) attaching
    to a node side  */
interface PortRef {
    edge: number
    role: "s" | "t"
}

/*  distribute the edge attachment ports along each node side, ordered
    by the vertical position the edge approaches from (the approachY
    override where given, the opposite endpoint center otherwise) and
    separated by at most the port gap of their node side (less, if the
    node box is too small to hold them all). A port with a fixed
    vertical offset from the box center (fixedY, the edge ends
    attaching to a container box at the position of the inner gate
    node) is placed exactly there and the distributed ports of the same
    side are dealt into the gaps around it. The edge ends merged into
    one port take the place of a single port, ordered by the mean of
    their approaches  */
export const assignPorts = (
    edges:      Edge[],
    sides:      { s: Side, t: Side }[],
    cx:         (id: string) => number,
    cy:         (id: string) => number,
    boxW:       Map<string, number>,
    boxH:       Map<string, number>,
    portGap:    (id: string, side: Side) => number,
    approachY?: (edge: number) => number | undefined,
    fixedY?:    (edge: number, role: "s" | "t") => number | undefined,
    merged?:    (edge: number, role: "s" | "t") => string | undefined
): Map<string, { x: number, y: number }> => {
    /*  group the edge endpoints by the node side they attach to  */
    const portGroups = new Map<string, PortRef[]>()
    const addPort    = (key: string, edge: number, role: "s" | "t") => {
        const group = portGroups.get(key)
        if (group === undefined)
            portGroups.set(key, [ { edge, role } ])
        else
            group.push({ edge, role })
    }
    edges.forEach((edge, i) => {
        addPort(`${edge.source}:${sides[i].s}`, i, "s")
        addPort(`${edge.target}:${sides[i].t}`, i, "t")
    })

    /*  place the ports of each group, ordered by the opposite endpoint
        (a merge reduced to its first edge end, standing for all of them,
        whose port the others share at the end)  */
    const portPos = new Map<string, { x: number, y: number }>()
    const first   = new Map<string, PortRef>()
    const mates   = new Map<PortRef, PortRef[]>()
    for (const [ key, all ] of portGroups) {
        const group = all.filter((p) => {
            const m = fixedY?.(p.edge, p.role) === undefined ? merged?.(p.edge, p.role) : undefined
            if (m !== undefined && !first.has(m))
                first.set(m, p)
            const rep = m !== undefined ? first.get(m)! : p
            mates.set(rep, [ ...(mates.get(rep) ?? []), p ])
            return rep === p
        })
        const sep     = key.lastIndexOf(":")  /*  ids may contain a colon themselves  */
        const id      = key.slice(0, sep)
        const side    = key.slice(sep + 1) as Side

        /*  spread the north side ports along the top side, in reverse
            edge order, so the innermost of the nested self-loops
            attaches closest to the top-right box corner  */
        if (side === "n") {
            group.sort((a, b) => b.edge - a.edge)
            const spacing = Math.min(portGap(id, side), (boxW.get(id)! - PORT_PAD) / group.length)
            group.forEach((p, idx) => {
                portPos.set(`${p.edge}:${p.role}`, {
                    x: cx(id) + (idx - (group.length - 1) / 2) * spacing,
                    y: cy(id) - boxH.get(id)! / 2
                })
            })
            continue
        }
        const px = cx(id) + (side === "e" ? +1 : -1) * boxW.get(id)! / 2

        /*  place the fixed ports at their given offsets  */
        const fixedOf = (p: PortRef) =>
            fixedY?.(p.edge, p.role)
        const place   = (p: PortRef, py: number) =>
            portPos.set(`${p.edge}:${p.role}`, { x: px, y: py })
        const taken: number[] = []
        for (const p of group.filter((p) => fixedOf(p) !== undefined)) {
            const py = cy(id) + fixedOf(p)!
            place(p, py)
            taken.push(py)
        }
        taken.sort((a, b) => a - b)

        /*  spread the remaining ports, ordered by their approach and
            at the spacing leaving room for the fixed ports, too (with
            no fixed port, simply centered on the box)  */
        const free    = group.filter((p) => fixedOf(p) === undefined)
        const otherOf = (p: PortRef) =>
            p.role === "s" ? edges[p.edge].target : edges[p.edge].source
        const approach = (p: PortRef) =>
            approachY?.(p.edge) ?? cy(otherOf(p))
        const keyOf   = (p: PortRef) =>
            mates.get(p)!.reduce((sum, q) => sum + approach(q), 0) / mates.get(p)!.length
        free.sort((a, b) => (keyOf(a) - keyOf(b)) || (a.edge - b.edge))
        const n       = free.length + taken.length
        const spacing = Math.min(portGap(id, side), (boxH.get(id)! - PORT_PAD) / n)
        if (taken.length === 0) {
            free.forEach((p, idx) => place(p, cy(id) + (idx - (n - 1) / 2) * spacing))
            continue
        }

        /*  deal the free ports into the gaps between the fixed ports
            (each into the gap its approach falls into, overflowing into
            the neighboring gaps once a gap holds as many ports as fit
            into it at the spacing) and place the ports of every gap at
            their slots of the even distribution of all ports, shifted
            into the gap as far as needed (and squeezed if not fitting)  */
        const lo    = cy(id) - (boxH.get(id)! - PORT_PAD) / 2 + spacing / 2
        const hi    = cy(id) + (boxH.get(id)! - PORT_PAD) / 2 - spacing / 2
        const walls = [ lo - spacing, ...taken, hi + spacing ]
        const gapOf = (p: PortRef) =>
            taken.filter((ty) => ty < keyOf(p)).length
        const gaps  = walls.slice(1).map((wall, j) => ({
            lo:    Math.max(lo, walls[j] + spacing),
            hi:    Math.min(hi, wall - spacing),
            ports: free.filter((p) => gapOf(p) === j)
        }))
        const capOf = (gap: { lo: number, hi: number }) =>
            gap.hi < gap.lo ? 0 : Math.floor((gap.hi - gap.lo) / spacing) + 1
        for (let j = 0; j < gaps.length - 1; j++)
            while (gaps[j].ports.length > capOf(gaps[j]))
                gaps[j + 1].ports.unshift(gaps[j].ports.pop()!)
        for (let j = gaps.length - 1; j > 0; j--)
            while (gaps[j].ports.length > capOf(gaps[j]))
                gaps[j - 1].ports.push(gaps[j].ports.shift()!)
        let k = 0
        gaps.forEach((gap, j) => {
            const r     = gap.ports.length
            const step  = r > 1 ? Math.min(spacing, Math.max(gap.hi - gap.lo, 0) / (r - 1)) : spacing
            const first = Math.min(Math.max(cy(id) + (k + j - (n - 1) / 2) * spacing, gap.lo),
                gap.hi - (r - 1) * step)
            gap.ports.forEach((p, i) => place(p, first + i * step))
            k += r
        })
    }
    for (const [ rep, list ] of mates)
        for (const q of list)
            portPos.set(`${q.edge}:${q.role}`, portPos.get(`${rep.edge}:${rep.role}`)!)
    return portPos
}

