/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Edge, Graph }            from "./gradia-api-model.js"
import { Config }                       from "./gradia-api-config.js"
import { Poly, NodeStyle, Layout }      from "./gradia-api-render-base.js"
import { defaultStyleOf, markOf, placeLines, placeRadius, PLACE_RING, type NodeMark }
    from "./gradia-api-render-node.js"
import { PORT_PAD }                     from "./gradia-api-render-edge.js"
import { LevelContext, Containment, rejectContainers }
    from "./gradia-api-render-container.js"
import { render as renderGraph }        from "./gradia-api-type-graph.js"

/*  the kinds of the nodes of a Petri net  */
const petriKinds = [ "place", "transition" ] as const
type PetriKind = typeof petriKinds[number]

/*  the budget of the analysis across all parts of the net: the largest
    number of explored markings and of place comparisons against their
    predecessor markings, before it gives up determining the dead
    transitions and the unreachable places (keeping the rendering of an
    untrusted input fast)  */
const MARKINGS_MAX = 10000
const EFFORT_MAX   = 20000000

/*  the key of the internal annotation carrying the analysis results of a
    node from the preparation to the rendering, as its tooltip (a control
    character keeping it apart from all user attributes)  */
const INFO_KEY = "\u0001info"

/*  the special "petri" annotation (the kind of a node, an unknown value
    being rejected)  */
const petriOf = (node: Node): PetriKind | undefined => {
    const val = node.attrs.findLast((attr) => attr.key === "petri")?.val
    if (val === undefined)
        return undefined
    const kind = petriKinds.find((k) => k === val)
    if (kind === undefined)
        throw new Error(`invalid petri kind "${val}" of node "${node.id}" (expected "place" or "transition")`)
    return kind
}

/*  a count given as a text: an integer of at least the given minimum
    (or undefined for an invalid text)  */
const countOf = (text: string, min: number): number | undefined => {
    const num = /^\s*\d+\s*$/.test(text) ? Number(text) : NaN
    return Number.isSafeInteger(num) && num >= min ? num : undefined
}

/*  the special "tokens" and "capacity" annotations of a place (its
    initial tokens, at least 0, and its capacity, at least 1, an invalid
    value being rejected)  */
const countAttrOf = (node: Node, key: "tokens" | "capacity"): number | undefined => {
    const val = node.attrs.findLast((attr) => attr.key === key)?.val
    if (val === undefined)
        return undefined
    const min = key === "tokens" ? 0 : 1
    const num = countOf(val, min)
    if (num === undefined)
        throw new Error(`invalid ${key} "${val}" of place "${node.id}" (expected an integer of at least ${min})`)
    return num
}

/*  the weight of an arc: its arity, a positive integer (1 without an
    arity, an invalid one being rejected)  */
const weightOf = (edge: Edge): number => {
    if (edge.arity === undefined)
        return 1
    const num = countOf(edge.arity, 1)
    if (num === undefined)
        throw new Error(`invalid weight "${edge.arity}" of arc "${edge.source}" --> "${edge.target}" ` +
            "(expected a positive integer)")
    return num
}

/*  determine the kind of every node: the annotated ones (a "tokens" or
    "capacity" annotation implying a place), and from them all others
    connected to them, as every arc connects a place with a transition,
    while a part of the net without any annotated node starts with its
    first declared node as a place  */
const kindsOf = (graph: Graph): Map<string, PetriKind> => {
    const nodes = Array.from(graph.nodes.values())
    const arcs  = new Map<string, Edge[]>(nodes.map((node) => [ node.id, [] ]))
    for (const edge of graph.edges) {
        arcs.get(edge.source)!.push(edge)
        if (edge.target !== edge.source)
            arcs.get(edge.target)!.push(edge)
    }
    const kind = new Map<string, PetriKind>()
    for (const node of nodes) {
        const given = petriOf(node)
        const place = node.attrs.some((attr) => attr.key === "tokens" || attr.key === "capacity")
        if (given === "transition" && place)
            throw new Error(`transition "${node.id}" cannot carry tokens or a capacity`)
        if (given !== undefined || place)
            kind.set(node.id, given ?? "place")
    }

    /*  spread the kind of a node over its part of the net, rejecting an
        arc between two nodes of the same kind (the queue growing while
        being iterated)  */
    const spread = (id: string): void => {
        const queue = [ id ]
        for (const from of queue) {
            const other = kind.get(from) === "place" ? "transition" : "place"
            for (const edge of arcs.get(from)!) {
                const to = edge.source === from ? edge.target : edge.source
                if (!kind.has(to)) {
                    kind.set(to, other)
                    queue.push(to)
                }
                else if (kind.get(to) !== other)
                    throw new Error(`arc "${edge.source}" --> "${edge.target}" connects two ${kind.get(from)}s`)
            }
        }
    }
    for (const id of Array.from(kind.keys()))
        spread(id)
    for (const node of nodes) {
        if (kind.has(node.id))
            continue
        kind.set(node.id, "place")
        spread(node.id)
    }
    return kind
}

/*  determine the strongly connected components of a directed graph of
    the given successors (with the algorithm of Tarjan, iteratively, as
    the graph can be deep), as the component index of every vertex  */
const componentsOf = (succ: number[][]): number[] => {
    const n     = succ.length
    const index = new Array<number>(n).fill(-1)
    const low   = new Array<number>(n).fill(0)
    const comp  = new Array<number>(n).fill(-1)
    const stack: number[] = []
    let counter = 0
    let comps   = 0
    for (let s = 0; s < n; s++) {
        if (index[s] !== -1)
            continue
        index[s] = low[s] = counter++
        stack.push(s)
        const work: [ number, number ][] = [ [ s, 0 ] ]
        while (work.length > 0) {
            const top = work[work.length - 1]
            const v   = top[0]
            if (top[1] < succ[v].length) {
                const w = succ[v][top[1]++]
                if (index[w] === -1) {
                    index[w] = low[w] = counter++
                    stack.push(w)
                    work.push([ w, 0 ])
                }
                else if (comp[w] === -1)
                    low[v] = Math.min(low[v], index[w])
                continue
            }
            work.pop()
            if (work.length > 0)
                low[work[work.length - 1][0]] = Math.min(low[work[work.length - 1][0]], low[v])
            if (low[v] === index[v]) {
                let w: number
                do {
                    w = stack.pop()!
                    comp[w] = comps
                } while (w !== v)
                comps++
            }
        }
    }
    return comp
}

/*  validate a graph model as a Petri net, with the kinds of all of its
    nodes made explicit, analyze every connected part of it, with the
    results attached to its nodes as their tooltips, and mark its dead and
    non-live transitions and its unreachable, unbounded, and dead-end
    places (unless the marking of the violations is disabled, and except
    the nodes carrying an explicit mark already)  */
export const prepare = (input: Graph, _containment: Containment, config: Config): Graph => {
    const nodes = Array.from(input.nodes.values())
    rejectContainers("petri", nodes, {})
    const kind = kindsOf(input)

    /*  the initial tokens and the capacities of the places  */
    const tokens   = new Map<string, number>()
    const capacity = new Map<string, number>()
    for (const node of nodes) {
        if (kind.get(node.id) !== "place")
            continue
        const n = countAttrOf(node, "tokens") ?? 0
        const k = countAttrOf(node, "capacity")
        if (k !== undefined && n > k)
            throw new Error(`place "${node.id}" carries more tokens than its capacity`)
        tokens.set(node.id, n)
        if (k !== undefined)
            capacity.set(node.id, k)
    }

    /*  the weighted input places ("pre") and output places ("post") of
        the transitions, the weights of parallel arcs adding up, and their
        inhibiting places ("inhib"), the lowest weight of parallel inhibitor
        arcs winning  */
    const pre   = new Map<string, Map<string, number>>()
    const post  = new Map<string, Map<string, number>>()
    const inhib = new Map<string, Map<string, number>>()
    for (const node of nodes) {
        if (kind.get(node.id) !== "transition")
            continue
        pre.set(node.id, new Map())
        post.set(node.id, new Map())
        inhib.set(node.id, new Map())
    }
    for (const edge of input.edges) {
        const w = weightOf(edge)
        if (edge.kind === "inhibitor") {
            if (kind.get(edge.source) !== "place")
                throw new Error(`inhibitor arc "${edge.source}" --> "${edge.target}" ` +
                    "has to lead from a place to a transition")
            const arcs = inhib.get(edge.target)!
            arcs.set(edge.source, Math.min(arcs.get(edge.source) ?? Infinity, w))
            continue
        }
        const [ t, p, arcs ] = kind.get(edge.source) === "transition" ?
            [ edge.source, edge.target, post ] : [ edge.target, edge.source, pre ]
        arcs.get(t)!.set(p, (arcs.get(t)!.get(p) ?? 0) + w)
    }

    /*  make the kinds of all nodes explicit, with their analysis results
        and marks attached  */
    const infos = new Map<string, string>()
    const marks = new Map<string, NodeMark>()
    const result = (): Graph => ({
        nodes: new Map(nodes.map((node) => {
            const info = infos.get(node.id)
            const mark = config["mark-violation"] && markOf(node) === undefined ? marks.get(node.id) : undefined
            return [ node.id, { ...node, attrs: [
                ...node.attrs.filter((attr) => attr.key !== "petri" && attr.key !== INFO_KEY),
                { key: "petri", val: kind.get(node.id)! },
                ...(info !== undefined ? [ { key: INFO_KEY, val: info } ] : []),
                ...(mark !== undefined ? [ { key: "mark", val: mark } ] : []) ] } ]
        })),
        edges: input.edges
    })

    /*  a net without any initial token and without any transition firing
        without one is inert (e.g. merely sketched), and hence not analyzed  */
    if (!Array.from(tokens.values()).some((n) => n > 0) && !Array.from(pre.values()).some((arcs) => arcs.size === 0))
        return result()

    /*  analyze a connected part of the net: explore its markings from the
        initial one (with the algorithm of Karp and Miller, where a marking
        covering one of its predecessors, i.e. holding at least as many
        tokens in every place, the same in a place of a capacity, and more
        in some place, lets these places grow without bound, as the firing
        sequence in between can be repeated, hence their tokens become
        infinite, except for a part with inhibitor arcs, where this does not
        hold, and which hence is explored as is), and determine the
        transitions which ever fire, the most tokens of every place, the
        places which hold a token in a deadlock (a marking enabling no
        transition) while having a transition to feed, and the transitions
        which are not live  */
    let markings = 0
    let effort   = 0
    const analyze = (part: string[]): void => {
        const places  = part.filter((id) => kind.get(id) === "place")
        const trans   = part.filter((id) => kind.get(id) === "transition")
        const index   = new Map(places.map((id, p) => [ id, p ]))
        const cap     = places.map((id) => capacity.get(id))
        const inputs  = trans.map((t) => Array.from(pre.get(t)!, ([ id, w ]) => [ index.get(id)!, w ] as const))
        const inhibit = trans.map((t) => Array.from(inhib.get(t)!, ([ id, w ]) => [ index.get(id)!, w ] as const))
        const effects = trans.map((t) => {
            const effect = new Map<number, number>()
            for (const [ id, w ] of pre.get(t)!)
                effect.set(index.get(id)!, (effect.get(index.get(id)!) ?? 0) - w)
            for (const [ id, w ] of post.get(t)!)
                effect.set(index.get(id)!, (effect.get(index.get(id)!) ?? 0) + w)
            return Array.from(effect)
        })
        const feeding    = new Set(inputs.flatMap((arcs) => arcs.map(([ p ]) => p)))
        const initial    = places.map((id) => tokens.get(id)!)
        const accelerate = !inhibit.some((arcs) => arcs.length > 0)

        /*  a transition is enabled if its input places hold enough tokens,
            its inhibiting places fewer tokens than the weights of their
            inhibitor arcs, and its output places stay within their
            capacities  */
        const enabled = (m: number[], i: number): boolean =>
            inputs[i].every(([ p, w ]) => m[p] >= w)
            && inhibit[i].every(([ p, w ]) => m[p] < w)
            && effects[i].every(([ p, d ]) => cap[p] === undefined || m[p] + d <= cap[p])

        /*  explore the markings breadth-first (within the budget shared by
            all parts), recording the successors of every explored marking,
            and the first (hence a shortest-reached) marking in which a place
            holds a token in a deadlock or grows without bound (with the
            predecessor marking it covers, as the firings in between pump it)  */
        interface Visit { m: number[], up?: Visit, via?: number, next: number[], fires: number[],
            pumps?: Map<number, Visit> }
        const queue: Visit[] = [ { m: initial, next: [], fires: [] } ]
        const known = new Map([ [ initial.join(","), 0 ] ])
        const fired = new Set<number>()
        const most  = places.map(() => 0)
        const stuck = new Map<number, Visit>()
        const grown = new Map<number, Visit>()
        let complete = markings < MARKINGS_MAX && effort <= EFFORT_MAX
        markings++
        for (let q = 0; q < queue.length && complete; q++) {
            const m = queue[q].m
            m.forEach((n, p) => {
                most[p] = Math.max(most[p], n)
                if (n === Infinity && !grown.has(p))
                    grown.set(p, queue[q])
            })
            let live = false
            for (let i = 0; i < trans.length && complete; i++) {
                if (!enabled(m, i))
                    continue
                live = true
                fired.add(i)
                const next = m.slice()
                for (const [ p, d ] of effects[i])
                    next[p] += d
                const pumps = new Map<number, Visit>()
                for (let up = accelerate ? queue[q] : undefined; up !== undefined && complete; up = up.up) {
                    /*  check whether the marking covers the predecessor marking,
                        counting the place comparisons actually performed  */
                    const covered = up
                    const prev    = up.m
                    let covers = true
                    let more   = false
                    for (let p = 0; p < next.length && covers; p++) {
                        effort++
                        if (cap[p] === undefined ? next[p] < prev[p] : next[p] !== prev[p])
                            covers = false
                        else if (next[p] > prev[p])
                            more = true
                    }
                    if (effort > EFFORT_MAX)
                        complete = false
                    else if (covers && more)
                        next.forEach((n, p) => {
                            if (n > prev[p]) {
                                next[p] = Infinity
                                pumps.set(p, covered)
                            }
                        })
                }
                const key = next.join(",")
                if (!complete)
                    continue
                if (!known.has(key)) {
                    if (markings >= MARKINGS_MAX) {
                        complete = false
                        continue
                    }
                    known.set(key, queue.length)
                    markings++
                    queue.push({ m: next, up: queue[q], via: i, next: [], fires: [], pumps })
                }
                queue[q].next.push(known.get(key)!)
                queue[q].fires.push(i)
            }
            if (!live)
                m.forEach((n, p) => {
                    if (n > 0 && feeding.has(p) && !stuck.has(p))
                        stuck.set(p, queue[q])
                })
        }

        /*  the firing sequence reaching an explored marking from the initial
            one (or from the given predecessor marking), shortened beyond a
            dozen firings  */
        const firingsOf = (visit: Visit, from?: Visit): string => {
            const names: string[] = []
            for (let v: Visit | undefined = visit; v !== from && v?.up !== undefined; v = v.up)
                names.unshift(trans[v.via!])
            return [ ...names.slice(0, 12), ...(names.length > 12 ?
                [ `... (${names.length - 12} more)` ] : []) ].join(", ")
        }
        const deadlockOf = (visit: Visit): string =>
            visit.up === undefined ? "in the initial marking" : `reached by firing: ${firingsOf(visit)}`

        /*  the firing sequence letting a place grow without bound: the one
            from the predecessor marking it covers, to be repeated, after the
            one reaching that predecessor marking  */
        const pumpOf = (visit: Visit, p: number): string => {
            const from = visit.pumps?.get(p)
            if (from === undefined)
                return `after firing: ${firingsOf(visit)}`
            return `by repeating: ${firingsOf(visit, from)}` +
                (from.up !== undefined ? `, after: ${firingsOf(from)}` : "")
        }

        /*  a transition firing at all is not live if it cannot fire again
            once the net has entered a recurring behavior without it, i.e.,
            if it fires nowhere within some terminal group of markings (a
            strongly connected component of the reachability graph, only
            available for a completely explored bounded part, no transition
            leading out of), which holds a firing (as a deadlock is caught
            by the dead-end places already)  */
        const bounded  = complete && most.every((n) => n !== Infinity)
        const nonLive  = new Set<number>()
        if (bounded) {
            const comp     = componentsOf(queue.map((visit) => visit.next))
            const leaving  = new Set<number>()
            const recurs   = new Map<number, Set<number>>()
            queue.forEach((visit, v) => {
                visit.next.forEach((w, k) => {
                    if (comp[w] !== comp[v])
                        leaving.add(comp[v])
                    else
                        recurs.set(comp[v], (recurs.get(comp[v]) ?? new Set()).add(visit.fires[k]))
                })
            })
            for (const [ c, within ] of recurs)
                if (!leaving.has(c))
                    fired.forEach((i) => {
                        if (!within.has(i))
                            nonLive.add(i)
                    })
        }

        /*  attach the analysis results as tooltips (with the firing sequences
            reaching a deadlock or letting a place grow without bound, and a
            capacity never reached) and determine the marks: the places never
            holding a token and the transitions never firing (both only once
            all markings were explored), the places holding a token in a
            deadlock, the places growing without bound, and the transitions
            not being live  */
        places.forEach((id, p) => {
            const bound = most[p] === Infinity ? "unbounded" :
                complete ? `at most ${most[p]}` : `at least ${most[p]} (analysis incomplete)`
            infos.set(id, [ `tokens: ${initial[p]} initially, ${bound}`,
                ...(complete && most[p] === 0 ? [ "never holds a token" ] : []),
                ...(stuck.has(p) ? [ `holds a token in a deadlock, ${deadlockOf(stuck.get(p)!)}` ] : []),
                ...(grown.has(p) ? [ `grows without bound ${pumpOf(grown.get(p)!, p)}` ] : []),
                ...(complete && cap[p] !== undefined && most[p] < cap[p] ?
                    [ `capacity ${cap[p]} never reached` ] : []) ].join("\n"))
            if (complete && most[p] === 0)
                marks.set(id, "unreachable")
            else if (stuck.has(p))
                marks.set(id, "dead-end")
            else if (most[p] === Infinity)
                marks.set(id, "unbounded")
        })
        const deadlock = queue.some((visit) => visit.next.length === 0)
        trans.forEach((id, i) => {
            infos.set(id, !complete ? (fired.has(i) ? "fires (analysis incomplete)" :
                "found never firing so far (analysis incomplete)") :
                !fired.has(i) ? "never fires" :
                    nonLive.has(i) ? "fires, but can get disabled forever (not live)" :
                        !bounded ? "fires" :
                            deadlock ? "fires, but not live (a deadlock is reachable)" :
                                "live (can always fire again)")
            if (complete && !fired.has(i))
                marks.set(id, "dead")
            else if (nonLive.has(i))
                marks.set(id, "non-live")
        })
    }

    /*  analyze every connected part of the net on its own, as their
        markings evolve independently and their combinations would just
        multiply the explored markings  */
    const near = new Map<string, string[]>(nodes.map((node) => [ node.id, [] ]))
    for (const edge of input.edges) {
        near.get(edge.source)!.push(edge.target)
        near.get(edge.target)!.push(edge.source)
    }
    const seen = new Set<string>()
    for (const node of nodes) {
        if (seen.has(node.id))
            continue
        const part = [ node.id ]
        seen.add(node.id)
        for (const id of part) {
            for (const next of near.get(id)!) {
                if (seen.has(next))
                    continue
                seen.add(next)
                part.push(next)
            }
        }
        analyze(part)
    }
    return result()
}

/*  lay out a graph model as a Petri net: as a "graph" whose arcs are
    never bundled, a pair of opposite plain arcs merged into one arc with
    an arrow head at both ends, with its places drawn as circles around
    their names, tokens, and capacities, in the place colors, and its
    transitions as regular node boxes, all with their analysis results as
    their tooltips  */
export const render = async (input: Graph, config: Config, level: LevelContext = {}): Promise<Layout> => {
    /*  strip the annotations consumed here off the nodes (and the badge
        and multiplicity off a place, as its circle cannot carry them)  */
    const tokens   = new Map<string, number>()
    const capacity = new Map<string, number>()
    const infos    = new Map<string, string>()
    const nodes    = new Map<string, Node>()
    for (const [ id, node ] of input.nodes) {
        const place = petriOf(node) === "place"
        const info  = node.attrs.findLast((attr) => attr.key === INFO_KEY)?.val
        const cap   = place ? countAttrOf(node, "capacity") : undefined
        if (place)
            tokens.set(id, countAttrOf(node, "tokens") ?? 0)
        if (cap !== undefined)
            capacity.set(id, cap)
        if (info !== undefined)
            infos.set(id, info)
        nodes.set(id, { ...node, attrs: node.attrs.filter((attr) =>
            attr.key !== "petri" && attr.key !== "tokens" && attr.key !== INFO_KEY
            && !(place && (attr.key === "badge" || attr.key === "multiple" || attr.key === "capacity"))) })
    }

    /*  merge every pair of opposite plain arcs (without a name and of the
        same weight, e.g. the arcs of a place merely tested by a transition)
        into the first one, drawn with an arrow head at both ends  */
    const plain   = (edge: Edge) => (edge.kind ?? "sync") === "sync" && edge.name === undefined
    const twoway  = new Set<Edge>()
    const dropped = new Set<Edge>()
    input.edges.forEach((edge, i) => {
        if (!plain(edge) || twoway.has(edge) || dropped.has(edge))
            return
        const twin = input.edges.find((other, j) => j > i && plain(other)
            && !twoway.has(other) && !dropped.has(other) && other.source === edge.target
            && other.target === edge.source && other.arity === edge.arity)
        if (twin === undefined)
            return
        twoway.add(edge)
        dropped.add(twin)
    })
    const graph: Graph = { nodes, edges: input.edges.filter((edge) => !dropped.has(edge)) }

    /*  the sink places: the places with incoming but without outgoing arcs,
        where the tokens come to rest  */
    const sinks = new Set(Array.from(tokens.keys()).filter((id) =>
        input.edges.some((edge) => edge.target === id) && !input.edges.some((edge) => edge.source === id)))

    /*  fix the box sizes of the places: their circles enclosing each of
        their lines (see "placeLines") and, for a sink, its inner circle, at
        least three attribute font sizes wide, and large enough to keep their
        ports clear of their top and bottom  */
    const fixedSize = new Map<string, { w: number, h: number }>(level.fixedSize)
    for (const [ id, n ] of tokens) {
        const ends = Math.max(graph.edges.filter((edge) => edge.source === id).length,
            graph.edges.filter((edge) => edge.target === id).length)
        const d    = Math.ceil(Math.max(config["size-font-prop"] * 3,
            (placeRadius(placeLines(nodes.get(id)!, n, capacity.get(id), config)) +
                (sinks.has(id) ? PLACE_RING : 0)) * 2,
            (ends - 1) * config["size-edge-port-gap"] * 1.5 + PORT_PAD))
        fixedSize.set(id, { w: d, h: d })
    }
    const layout = await renderGraph(graph, config, { ...level, fixedSize }, undefined, true)

    /*  draw the arc ends attaching to a place up to its circle, along their
        final segments (horizontal at a west or east side port, vertical at
        a north side one)  */
    const inset = (poly: Poly, end: number, prev: number, id: string): void => {
        if (!tokens.has(id) || poly.length < 2)
            return
        const r = layout.boxW.get(id)! / 2
        const [ x,  y  ] = poly[end]
        const [ px, py ] = poly[prev]
        const [ dx, dy ] = [ x - layout.cx(id), y - layout.cy(id) ]
        if (py === y && Math.abs(dy) < r)
            poly[end] = [ layout.cx(id) + Math.sign(dx) * Math.sqrt(r * r - dy * dy), y ]
        else if (px === x && Math.abs(dx) < r)
            poly[end] = [ x, layout.cy(id) + Math.sign(dy) * Math.sqrt(r * r - dx * dx) ]
    }
    const polys = layout.polys.map((poly, i): Poly => {
        const pts: Poly = poly.map(([ x, y ]) => [ x, y ])
        inset(pts, pts.length - 1, pts.length - 2, layout.edges[i].target)
        inset(pts, 0, 1, layout.edges[i].source)
        return pts
    })

    /*  draw the places as circles with their tokens and capacities, in the
        light place colors, so the transitions stand out from them  */
    const styleOf = (node: Node): NodeStyle => tokens.has(node.id) ?
        { fill: "color-node-place-box", stroke: "color-node-place-border", text: "color-node-place-name",
            tokens: tokens.get(node.id)!, capacity: capacity.get(node.id), sink: sinks.has(node.id),
            title: infos.get(node.id) } :
        { ...defaultStyleOf(node), title: infos.get(node.id) }
    return { ...layout, polys, styleOf, twoway: layout.edges.map((edge) => twoway.has(edge)) }
}
