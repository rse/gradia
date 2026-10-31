/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Edge, Graph }            from "./gradia-api-model.js"
import { Config }                       from "./gradia-api-config.js"
import { Poly, NodeShape, NodeStyle, Layout }
    from "./gradia-api-render-base.js"
import { defaultStyleOf, markOf, shapeRadius, shapeReach, type NodeMark }
    from "./gradia-api-render-node.js"
import { PORT_PAD, transitionOf }       from "./gradia-api-render-edge.js"
import { LevelContext, Containment }    from "./gradia-api-render-container.js"
import { render as renderGraph }        from "./gradia-api-type-graph.js"

/*  the fixed box sizes of the pseudo-states (the bars of a fork and a
    join taking a fixed width only, as their height grows with their edges)  */
const SHAPE_SIZE: Record<NodeShape, number> = {
    "initial":      24,
    "final":        24,
    "choice":       32,
    "history":      26,
    "deep-history": 26,
    "junction":     16,
    "fork":         8,
    "join":         8,
    "entry-point":  22,
    "exit-point":   22,
    "terminate":    22
}

/*  the special "state" annotation (the kind of a pseudo-state, an
    unknown value being rejected)  */
const stateOf = (node: Node): NodeShape | undefined => {
    const val = node.attrs.findLast((attr) => attr.key === "state")?.val
    if (val === undefined)
        return undefined
    if (!Object.hasOwn(SHAPE_SIZE, val))
        throw new Error(`invalid state "${val}" of node "${node.id}" (expected ` +
            `${Object.keys(SHAPE_SIZE).map((key) => `"${key}"`).join(", ")})`)
    return val as NodeShape
}

/*  the event and the optional guard of a transition  */
const labelOf = (edge: Edge): { event: string, guard?: string } =>
    transitionOf(edge.name ?? "")

/*  validate a graph model as a state machine and mark its unreachable,
    dead-end, and incomplete states and its conflicting transitions (unless
    the marking of the violations is disabled, and except the states
    carrying an explicit mark already)  */
export const prepare = (graph: Graph, containment: Containment, config: Config): Graph => {
    const nodes = Array.from(graph.nodes.values())
    const kind  = new Map(nodes.map((node) => [ node.id, stateOf(node) ]))
    const outOf = (id: string): Edge[] => graph.edges.filter((edge) => edge.source === id)
    const into  = (id: string): Edge[] => graph.edges.filter((edge) => edge.target === id)

    /*  the members of a composite state (or of the top level) of a kind  */
    const membersOf = (shape: NodeShape, id?: string): Node[] =>
        (id === undefined ? nodes.filter((node) => !containment.parentOf.has(node.id)) :
            containment.childrenOf.get(id) ?? []).filter((node) => kind.get(node.id) === shape)

    /*  a state together with its ancestors, innermost first  */
    const ancestorsOf = (id: string): string[] => {
        const ids = [ id ]
        for (let p = containment.parentOf.get(id); p !== undefined; p = containment.parentOf.get(p))
            ids.push(p)
        return ids
    }

    /*  a completion transition: an unlabeled (but optionally guarded) one
        out of a composite state, firing only once an inner final state is
        reached  */
    const completion = (edge: Edge): boolean =>
        containment.childrenOf.has(edge.source) && labelOf(edge).event === ""
    const fires = (edge: Edge): boolean =>
        !completion(edge) || membersOf("final", edge.source).length > 0

    /*  validate the pseudo-states and the transitions entering a composite
        state, as the reachability would be undefined otherwise  */
    for (const node of nodes) {
        const k   = kind.get(node.id)
        const out = outOf(node.id).length
        const inc = into(node.id).length
        if (k !== undefined && containment.childrenOf.has(node.id))
            throw new Error(`pseudo-state "${node.id}" cannot be a composite state`)
        if (k === "initial" && inc > 0)
            throw new Error(`initial state "${node.id}" cannot have an incoming transition`)
        if ((k === "final" || k === "terminate") && out > 0)
            throw new Error(`${k} state "${node.id}" cannot have an outgoing transition`)
        if ((k === "choice" || k === "junction" || k === "fork" || k === "join" || k === "entry-point") && out === 0)
            throw new Error(`${k} "${node.id}" requires an outgoing transition`)
        if ((k === "history" || k === "deep-history" || k === "entry-point" || k === "exit-point")
            && !containment.parentOf.has(node.id))
            throw new Error(`${k} "${node.id}" has to be a member of a composite state`)
        if ((k === "history" || k === "deep-history" || k === "join") && out > 1)
            throw new Error(`${k} "${node.id}" cannot have more than one outgoing transition`)
        if ((k === "history" || k === "deep-history") && out === 0
            && membersOf("initial", containment.parentOf.get(node.id)).length === 0)
            throw new Error(`${k} "${node.id}" requires a default transition, as its composite state ` +
                `"${containment.parentOf.get(node.id)}" has no initial state`)
        if (k === "fork" && inc > 1)
            throw new Error(`fork "${node.id}" cannot have more than one incoming transition`)
        if (containment.childrenOf.has(node.id))
            for (const shape of [ "initial", "history", "deep-history" ] as const)
                if (membersOf(shape, node.id).length > 1)
                    throw new Error(`composite state "${node.id}" cannot have more than one ${shape} state`)
    }
    if (membersOf("initial").length > 1)
        throw new Error("state machine cannot have more than one initial state on its top level")
    for (const edge of graph.edges)
        if (containment.childrenOf.has(edge.target) && membersOf("initial", edge.target).length === 0)
            throw new Error(`transition "${edge.source}" --> "${edge.target}" enters ` +
                `composite state "${edge.target}" without an initial state`)
    if (!config["mark-violation"])
        return graph

    /*  determine the states reachable from the top-level initial state:
        entering a composite state (by a transition into it, not merely into
        one of its members) enters its initial state, too, entering one of
        its history states resumes it (at the latest at its initial state),
        being in a state means being in all its ancestors, whose transitions
        hence apply, too, a completion transition fires once an inner final
        state is reached, and a join once all of its sources are reached  */
    const reached = new Set<string>()
    const entered = new Set<string>()
    const queue: string[] = []
    const reach = (id: string, entry: boolean): void => {
        const parent = containment.parentOf.get(id)
        if (!reached.has(id)) {
            reached.add(id)
            queue.push(id)
            if (kind.get(id) === "final" && parent !== undefined)
                queue.push(parent)
        }
        if (entry && !entered.has(id)) {
            entered.add(id)
            for (const initial of membersOf("initial", id))
                reach(initial.id, true)
            if ((kind.get(id) === "history" || kind.get(id) === "deep-history") && parent !== undefined)
                reach(parent, true)
        }
        if (parent !== undefined && !reached.has(parent))
            reach(parent, false)
    }
    for (const initial of membersOf("initial"))
        reach(initial.id, true)
    while (queue.length > 0) {
        const id = queue.shift()!
        for (const edge of outOf(id)) {
            if (!fires(edge) || (completion(edge) && !membersOf("final", id).some((f) => reached.has(f.id))))
                continue
            if (kind.get(edge.target) === "join" && !into(edge.target).every((e) => reached.has(e.source)))
                continue
            reach(edge.target, true)
        }
    }

    /*  the successors of a state: the targets of the transitions leading
        out of it, i.e. of its own ones, (for a composite state) of the ones
        of its members leaving it, and of the ones of its ancestors (a
        completion transition only of a composite state with a final state)  */
    const successors = (id: string): string[] => graph.edges.filter((edge) => fires(edge) && (
        ancestorsOf(id).slice(1).includes(edge.source)
        || (ancestorsOf(edge.source).includes(id) && (edge.source === id || !ancestorsOf(edge.target).includes(id)))
    )).map((edge) => edge.target)

    /*  a regular state is a dead end if it is trapped: if it belongs to a
        group of states (a strongly connected component, determined with
        the algorithm of Tarjan) no transition leads out of, which does not
        hold a final or terminate state, e.g. a single state without any
        transition leading out of it, or two states only leading into each
        other  */
    const index = new Map<string, number>()
    const low   = new Map<string, number>()
    const stack: string[] = []
    const trapped = new Set<string>()
    const connect = (id: string): void => {
        index.set(id, index.size)
        low.set(id, index.get(id)!)
        stack.push(id)
        for (const next of successors(id)) {
            if (!index.has(next)) {
                connect(next)
                low.set(id, Math.min(low.get(id)!, low.get(next)!))
            }
            else if (stack.includes(next))
                low.set(id, Math.min(low.get(id)!, index.get(next)!))
        }
        if (low.get(id) === index.get(id)) {
            const group = new Set(stack.splice(stack.indexOf(id)))
            if (Array.from(group).every((member) => successors(member).every((next) => group.has(next)))
                && !Array.from(group).some((member) => kind.get(member) === "final" || kind.get(member) === "terminate"))
                group.forEach((member) => trapped.add(member))
        }
    }
    for (const node of nodes)
        if (!index.has(node.id))
            connect(node.id)

    /*  a choice or junction is incomplete if all of its outgoing transitions
        are guarded, but none by "else", and a composite state if it has a
        final state, but no completion transition  */
    const incomplete = (id: string): boolean => {
        const k = kind.get(id)
        if (k === "choice" || k === "junction")
            return outOf(id).every((edge) => {
                const guard = labelOf(edge).guard
                return guard !== undefined && guard.toLowerCase() !== "else"
            })
        return containment.childrenOf.has(id) && membersOf("final", id).length > 0
            && !outOf(id).some((edge) => completion(edge))
    }

    /*  mark the unreachable states (only once there is a top-level initial
        state to reach them from), the regular dead-end states, and the
        incomplete choices, junctions, and composite states  */
    const marks = new Map<string, NodeMark>()
    for (const node of nodes) {
        if (markOf(node) !== undefined)
            continue
        if (membersOf("initial").length > 0 && !reached.has(node.id))
            marks.set(node.id, "unreachable")
        else if (incomplete(node.id))
            marks.set(node.id, "incomplete")
        else if (kind.get(node.id) === undefined && trapped.has(node.id))
            marks.set(node.id, "dead-end")
    }

    /*  mark the conflicting transitions: the ones leaving the same state
        (except a fork) on the same event with the same (or no) guard  */
    const conflicts = new Set<Edge>()
    for (const node of nodes) {
        if (kind.get(node.id) === "fork")
            continue
        const byLabel = new Map<string, Edge[]>()
        for (const edge of outOf(node.id)) {
            const { event, guard } = labelOf(edge)
            const key = JSON.stringify([ event, guard ?? null ])
            byLabel.set(key, [ ...byLabel.get(key) ?? [], edge ])
        }
        for (const edges of byLabel.values())
            if (edges.length > 1)
                edges.forEach((edge) => conflicts.add(edge))
    }
    if (marks.size === 0 && conflicts.size === 0)
        return graph
    return {
        nodes: new Map(nodes.map((node) => [ node.id, marks.has(node.id) ?
            { ...node, attrs: [ ...node.attrs, { key: "mark", val: marks.get(node.id)! } ] } : node ])),
        edges: graph.edges.map((edge) => conflicts.has(edge) ? { ...edge, marked: true } : edge)
    }
}

/*  lay out a graph model (or a containment level of it) as a state
    machine: as a "graph" whose transitions are never bundled, with the
    pseudo-states at the fixed box sizes of their shapes, the attributes
    (e.g. the behaviors "entry", "do", and "exit") of a regular state below
    a line dividing them from its name, and the composite states drawn
    solid, like the regular ones  */
export const render = async (graph: Graph, config: Config, level: LevelContext = {}): Promise<Layout> => {
    /*  fix the box sizes of the pseudo-states (a bar as high as its
        edges on the busier side demand)  */
    const shapes    = new Map<string, NodeShape>()
    const fixedSize = new Map<string, { w: number, h: number }>(level.fixedSize)
    for (const node of graph.nodes.values()) {
        const shape = stateOf(node)
        if (shape === undefined || fixedSize.has(node.id))
            continue
        shapes.set(node.id, shape)
        const ends = Math.max(graph.edges.filter((edge) => edge.source === node.id).length,
            graph.edges.filter((edge) => edge.target === node.id).length)
        fixedSize.set(node.id, shape === "fork" || shape === "join" ?
            { w: SHAPE_SIZE[shape], h: Math.max(40, ends * config["size-edge-port-gap"] + PORT_PAD) } :
            { w: SHAPE_SIZE[shape], h: SHAPE_SIZE[shape] })
    }
    const layout = await renderGraph(graph, config, { ...level, fixedSize }, undefined, true)

    /*  draw the edge ends attaching to a pseudo-state up to the outline of
        its shape, along their final segments (horizontal at a west or east
        side port, vertical at a north side one)  */
    const inset = (poly: Poly, end: number, prev: number, id: string): void => {
        const shape = shapes.get(id)
        if (shape === undefined || poly.length < 2)
            return
        const a = Math.min(layout.boxW.get(id)!, layout.boxH.get(id)!) / 2
        const r = shapeRadius(shape, a)
        const [ x,  y  ] = poly[end]
        const [ px, py ] = poly[prev]
        const [ dx, dy ] = [ x - layout.cx(id), y - layout.cy(id) ]
        if (py === y && Math.abs(dy) < r)
            poly[end] = [ layout.cx(id) + Math.sign(dx) * shapeReach(shape, a, dy), y ]
        else if (px === x && Math.abs(dx) < r)
            poly[end] = [ x, layout.cy(id) + Math.sign(dy) * shapeReach(shape, a, dx) ]
    }
    const polys = layout.polys.map((poly, i): Poly => {
        const pts: Poly = poly.map(([ x, y ]) => [ x, y ])
        inset(pts, pts.length - 1, pts.length - 2, layout.edges[i].target)
        inset(pts, 0, 1, layout.edges[i].source)
        return pts
    })

    /*  draw the pseudo-states as their shapes, in the pseudo-state colors,
        so they stand out from the regular states, whose behaviors are
        divided from their name, as are the members of a composite state
        (drawn solid, but in the container colors, so its members stand out)  */
    const styleOf = (node: Node): NodeStyle => {
        const shape = shapes.get(node.id)
        if (shape !== undefined)
            return { fill: "color-node-pseudo-box", stroke: "color-node-pseudo-border",
                text: "color-node-pseudo-name", shape }
        else if (level.fixedSize?.has(node.id) === true && level.gates?.has(node.id) !== true)
            return { fill: "color-container-box", stroke: "color-composite-border",
                text: "color-container-name", divided: true }
        else
            return { ...defaultStyleOf(node), divided: true }
    }
    return { ...layout, polys, styleOf, transitions: true }
}
