/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Edge, Graph }        from "./gradia-api-model.js"
import { Config, ConfigEmbedded }   from "./gradia-api-config.js"
import { Layout, textWidth, pushTo }
    from "./gradia-api-render-base.js"
import { Shape, pathShape, textShape, rectShape, badgeShape }
    from "./gradia-api-render-shape.js"
import { LevelContext, rejectContainers }
    from "./gradia-api-render-container.js"
import { ClusterPart, clusterOrder, clusterRuns, fitLabel }
    from "./gradia-api-render-cluster.js"
import { defaultStyleOf, urlOf, orderOf, typeOf, badgeOf, clusterOf, badgeRadius }
    from "./gradia-api-render-node.js"

/*  the geometry of the rows, the bars, the arrows, the headers, and the cluster bands  */
const ROW       = 44    /*  height of a row                             */
const BAR       = 24    /*  height of a task bar                        */
const MILE      = 10    /*  half diagonal of a milestone diamond        */
const STUB      = 10    /*  straight run of an arrow off its anchors    */
const ARROW     = 10    /*  length of an arrow head                     */
const TRACK     = 8     /*  min gap between vertical arrow segments     */
const SHIFT     = 60    /*  maximum shift of a vertical arrow segment   */
const APPROACH  = 6     /*  minimum straight run before an arrow head   */
const STRIP     = 3     /*  inset of a backward arrow into a row        */
const RING      = 4     /*  gap around the ring of a critical milestone */
const GUTTER    = 36    /*  room left and right of the time axis span   */
const TICK_PAD  = 12    /*  minimum air around a tick label             */
const TICK_MAX  = 100   /*  maximum number of time axis ticks           */
const HEAD_PAD  = 12    /*  padding inside a header along its label     */
const HEAD_GAP  = 8     /*  gap between the headers and the chart       */
const BAND      = 36    /*  thickness of a cluster band                 */
const BAND_PAD  = 4     /*  padding along the name in a cluster band    */
const BADGE_GAP = 12    /*  gap between a header label and its badge    */
const EPS       = 1e-9  /*  tolerance of the schedule comparisons       */

/*  the non-negative numeric "duration" (absent for a milestone) and
    "start" (the earliest start) attributes of a task  */
const numberOf = (node: Node, key: "duration" | "start"): number => {
    const val = node.attrs.findLast((attr) => attr.key === key)?.val
    if (val === undefined)
        return 0
    const num = Number(val)
    if (val.trim() === "" || !Number.isFinite(num) || num < 0)
        throw new Error(`invalid ${key} "${val}" of task "${node.id}" (expected a non-negative number)`)
    return num
}

/*  the lag of a dependency (its "duration" edge attribute, a negative
    one being a lead)  */
const lagOf = (edge: Edge): number => {
    if (edge.duration === undefined)
        return 0
    const num = Number(edge.duration)
    if (edge.duration.trim() === "" || !Number.isFinite(num))
        throw new Error(`invalid lag "${edge.duration}" of edge "${edge.source}" --> "${edge.target}" ` +
            "(expected a number)")
    return num
}

/*  the schedule of a task: its earliest and latest start and finish  */
interface Times { es: number, ef: number, ls: number, lf: number }

/*  schedule the tasks by the critical path method: a forward pass over the
    tasks in topological order (Kahn's algorithm, rejecting the tasks on or
    between cycles) determines their earliest start and finish, constrained
    by every dependency of its type (finish-to-start by default) plus its
    lag, and a backward pass from the project end their latest start and
    finish, while the tight dependencies are the ones determining the
    earliest start of their target  */
const schedule = (nodes: Node[], edges: Edge[]): { times: Map<string, Times>, tight: Set<Edge> } => {
    const dur   = new Map(nodes.map((node) => [ node.id, numberOf(node, "duration") ]))
    const start = new Map(nodes.map((node) => [ node.id, numberOf(node, "start") ]))
    const lag   = new Map(edges.map((edge) => [ edge, lagOf(edge) ]))
    const succ  = new Map<string, Edge[]>(nodes.map((node) => [ node.id, [] ]))
    const pred  = new Map<string, Edge[]>(nodes.map((node) => [ node.id, [] ]))
    for (const edge of edges) {
        succ.get(edge.source)!.push(edge)
        pred.get(edge.target)!.push(edge)
    }

    /*  order the tasks topologically (the array iteration also visiting
        the tasks appended meanwhile)  */
    const indeg = new Map(nodes.map((node) => [ node.id, pred.get(node.id)!.length ]))
    const order = nodes.filter((node) => indeg.get(node.id) === 0).map((node) => node.id)
    for (const id of order) {
        for (const edge of succ.get(id)!) {
            indeg.set(edge.target, indeg.get(edge.target)! - 1)
            if (indeg.get(edge.target) === 0)
                order.push(edge.target)
        }
    }

    /*  reject the cycles, naming the remaining tasks except the ones
        merely following a cycle  */
    if (order.length < nodes.length) {
        const done = new Set(order)
        const rest = new Set(nodes.map((node) => node.id).filter((id) => !done.has(id)))
        let trimmed = true
        while (trimmed) {
            trimmed = false
            for (const id of rest) {
                if (!succ.get(id)!.some((edge) => rest.has(edge.target))) {
                    rest.delete(id)
                    trimmed = true
                }
            }
        }
        throw new Error("diagram type \"gantt\" does not support cyclic dependencies " +
            `(between the tasks ${Array.from(rest, (id) => `"${id}"`).join(", ")})`)
    }

    /*  the forward pass: the earliest start a dependency implies for its target  */
    const times = new Map<string, Times>()
    const bound = (edge: Edge): number => {
        const s    = times.get(edge.source)!
        const type = edge.type ?? "fs"
        return (type === "fs" || type === "ff" ? s.ef : s.es) + lag.get(edge)! -
            (type === "ff" || type === "sf" ? dur.get(edge.target)! : 0)
    }
    for (const id of order) {
        const es = Math.max(0, start.get(id)!, ...pred.get(id)!.map(bound))
        times.set(id, { es, ef: es + dur.get(id)!, ls: 0, lf: 0 })
    }

    /*  the backward pass: the latest finish a dependency implies for its source  */
    const end = Math.max(0, ...Array.from(times.values(), (t) => t.ef))
    for (const id of order.slice().reverse()) {
        const lf = Math.min(end, ...succ.get(id)!.map((edge) => {
            const t    = times.get(edge.target)!
            const type = edge.type ?? "fs"
            return (type === "fs" || type === "ss" ? t.ls : t.lf) - lag.get(edge)! +
                (type === "ss" || type === "sf" ? dur.get(id)! : 0)
        }))
        const t = times.get(id)!
        t.lf = lf
        t.ls = lf - dur.get(id)!
    }
    const tight = new Set(edges.filter((edge) => Math.abs(bound(edge) - times.get(edge.target)!.es) < EPS))
    return { times, tight }
}

/*  a vertical arrow segment: its arrow, its feasible range, its
    preferred position, its extent, the anchors it attaches to, and its
    final position  */
type Vertical = { route: number, lo: number, hi: number, pref: number,
    ya: number, yb: number, keys: string[], x: number }

/*  place the vertical segments, the shortest first: each as close to
    its preferred position as possible, but a track off every segment
    running alongside, or else (in a too narrow gap) joining a segment
    sharing one of its anchors, or else with the fewest clashes  */
const placeVerticals = (verticals: Vertical[]): void => {
    const placed: Vertical[] = []
    for (const v of verticals.slice().sort((p, q) => (p.yb - p.ya) - (q.yb - q.ya))) {
        const near  = placed.filter((w) => w.route !== v.route && v.ya <= w.yb && w.ya <= v.yb)
        const cands: number[] = []
        for (let n = 0; n <= SHIFT; n++)
            for (const x of n === 0 ? [ v.pref ] : [ v.pref + n, v.pref - n ])
                if (v.lo <= x && x <= v.hi)
                    cands.push(x)
        const joins   = near.filter((w) => v.lo <= w.x && w.x <= v.hi && w.keys.some((key) => v.keys.includes(key)))
        const clashes = (x: number) => near.filter((w) =>
            Math.abs(x - w.x) < TRACK - EPS && !(x === w.x && joins.includes(w))).length
        v.x = cands.find((x) => near.every((w) => Math.abs(x - w.x) >= TRACK - EPS)) ??
            [ ...joins.map((w) => w.x), ...cands ].reduce((best, x) => clashes(x) < clashes(best) ? x : best)
        placed.push(v)
    }
}

/*  determine the rows: the tasks, partitioned into their clusters
    (exactly like the rows of a "matrix" diagram), and within every
    cluster either in the explicit order of their "order" attributes
    (the tasks without one trailing), or else by their earliest start
    (ties in declaration order), plus the clusters as parts of the rows  */
const rowsOf = (declared: Node[], times: Map<string, Times>): { rows: Node[], parts: ClusterPart[] } => {
    const ordered   = declared.some((node) => orderOf(node) !== undefined)
    const sorted    = declared.slice().sort((a, b) => ordered ?
        (orderOf(a) ?? Infinity) - (orderOf(b) ?? Infinity) || 0 :
        times.get(a.id)!.es - times.get(b.id)!.es)
    const clustered = declared.some((node) => clusterOf(node) !== undefined)
    const pathOf    = (node: Node): string[] => {
        if (!clustered)
            return []
        const path = clusterOf(node) ?? []
        return path.length > 0 ? path : [ "default" ]
    }
    const nameOf    = (node: Node) => pathOf(node).join("/")
    const rows: Node[] = []
    const parts: ClusterPart[] = []
    for (const name of clusterOrder(sorted.map((node) => [ nameOf(node), pathOf(node) ]))) {
        const members = sorted.filter((node) => nameOf(node) === name)
        parts.push({ path: pathOf(members[0]), from: rows.length, to: rows.length + members.length })
        rows.push(...members)
    }
    return { rows, parts }
}

/*  the time axis: the smallest step of 1, 2, 5, 10, 20, 50, ... time
    units leaving room for the widest tick label (at the given unit
    width and font size) and keeping the ticks bounded in number, and
    its span up to the project end, rounded up to whole steps  */
const axisOf = (end: number, unit: number, fs: number): { step: number, span: number } => {
    const stepOf = (k: number) => [ 1, 2, 5 ][k % 3] * 10 ** Math.floor(k / 3)
    const spanOf = (step: number) => Math.max(Math.ceil(end / step - EPS) * step, step)
    let k = 0
    while (stepOf(k) * unit < textWidth(String(spanOf(stepOf(k))), fs) + TICK_PAD
        || spanOf(stepOf(k)) / stepOf(k) > TICK_MAX)
        k++
    return { step: stepOf(k), span: spanOf(stepOf(k)) }
}

/*  lay out a graph model as a Gantt chart: the nodes are the tasks, one
    row each with its bar over a time axis, and the edges are the
    dependencies, drawn as arrows between the bars, with the critical path
    (the tasks without any slack and the tight dependencies among them) marked  */
export const render = async (graph: Graph, config: Config, level: LevelContext = {}): Promise<Layout> => {
    /*  ensure the graph carries no containers, as the rows are flat  */
    const declared = Array.from(graph.nodes.values())
    rejectContainers("gantt", declared, level)

    /*  schedule the tasks and determine the critical ones (marked only if
        the marking of the critical path is enabled)  */
    const { times, tight } = schedule(declared, graph.edges)
    const slackless = (id: string) => times.get(id)!.ls - times.get(id)!.es < EPS
    const critical  = (id: string) => config["gantt-critical"] && slackless(id)

    /*  determine the rows of the tasks, partitioned into their clusters  */
    const { rows, parts } = rowsOf(declared, times)
    const rowOf = new Map(rows.map((node, i) => [ node.id, i ]))
    const { depth, runs: clusters } = clusterRuns(parts)

    /*  resolve the configurable rendering geometry (with the cluster bands
        left of the row headers, and the time axis above the chart)  */
    const margin = config["size-canvas-margin"]
    const fsName = config["size-font-prop"]
    const fsNum  = config["size-font-type"]
    const fsLag  = config["size-font-edge"]
    const unit   = Math.max(config["gantt-unit-width"], 1)
    const band   = depth * (BAND + HEAD_GAP)

    /*  the arrows sharing a side of a bar (its start or its end, as source
        or target alike), each ranked (the one spanning the fewest rows
        innermost), for offsetting the strips of the backward arrows and
        widening the gutters left and right of the chart  */
    const arrows = graph.edges.map((edge) => {
        const type = edge.type ?? "fs"
        return { edge, fromEnd: type === "fs" || type === "ff", toStart: type === "fs" || type === "ss",
            dist: Math.abs(rowOf.get(edge.source)! - rowOf.get(edge.target)!) }
    })
    type Arrow = typeof arrows[number]
    const ends = new Map<string, { a: Arrow, source: boolean }[]>()
    for (const a of arrows) {
        pushTo(ends, `${a.edge.source}:${a.fromEnd}`, { a, source: true })
        pushTo(ends, `${a.edge.target}:${!a.toStart}`, { a, source: false })
    }
    const ks = new Map<Arrow, number>()
    const kt = new Map<Arrow, number>()
    for (const group of ends.values())
        group.slice().sort((p, q) => p.a.dist - q.a.dist)
            .forEach(({ a, source }, k) => (source ? ks : kt).set(a, k))
    const gutter = GUTTER + Math.max(0, ...ks.values(), ...kt.values()) * TRACK

    /*  the room in front of every row header label for the badges (see
        "matrix"), and the corner above the row headers: the title of the
        rows (the type shared by all tasks) and the name of the time unit  */
    const radius = badgeRadius(fsName)
    const room   = rows.some((node) => badgeOf(node) !== undefined) ? radius * 2 + BADGE_GAP : 0
    const [ title, ...more ] = new Set(rows.map((node) => typeOf(node)))
    const caption = more.length === 0 && title !== undefined && title !== "" ? title : undefined
    const unitName = config["gantt-unit-name"]
    const cornerW  = textWidth(caption ?? "", fsNum, true) + textWidth(unitName, fsNum) +
        (caption !== undefined && unitName !== "" ? HEAD_PAD : 0)
    const rowW   = Math.ceil(Math.max(rows.reduce((w, node) => Math.max(w, textWidth(node.name, fsName, true)), 0) + room,
        cornerW) + HEAD_PAD * 2)
    const axisH  = Math.ceil(fsNum * 2)
    const hx     = margin + band
    const hy     = margin
    const x0     = hx + rowW + HEAD_GAP + gutter
    const y0     = hy + axisH + HEAD_GAP

    /*  the time axis up to the project end  */
    const { step, span } = axisOf(Math.max(0, ...Array.from(times.values(), (t) => t.ef)), unit, fsNum)

    /*  the coordinates (rounded to two decimals, keeping the floating point
        noise of fractional durations out of the SVG)  */
    const round  = (v: number) => Math.round(v * 100) / 100
    const fmt    = (v: number) => String(round(v))
    const xOf    = (t: number) => round(x0 + t * unit)
    const cyOf   = (id: string) => y0 + rowOf.get(id)! * ROW + ROW / 2
    const left   = x0 - gutter
    const width  = span * unit + gutter * 2
    const height = rows.length * ROW

    /*  generate the shapes: the row headers (lying header boxes in the
        colors of the node boxes, exactly like the ones of a "matrix")  */
    const shapes: Shape[] = []
    rows.forEach((node, r) => {
        const style = defaultStyleOf(node)
        const y     = y0 + r * ROW
        shapes.push(rectShape(hx, y, rowW, ROW, style.stroke, 2, undefined, style.fill, 6))
        shapes.push(textShape(hx + HEAD_PAD + room, y + ROW / 2, node.name, "start", textWidth(node.name, fsName, true),
            style.text, "size-font-prop", fsName, { bold: true, url: urlOf(node), halo: false }))
        const badge = badgeOf(node)
        if (badge !== undefined)
            shapes.push(badgeShape(hx + HEAD_PAD + radius, y + ROW / 2, radius, badge, style))
    })

    /*  the cluster bands, each spanning the rows of a cluster left of their
        headers (exactly like the row bands of a "matrix")  */
    for (const { level, name, from, to } of clusters) {
        const off  = margin + level * (BAND + HEAD_GAP)
        const size = (to - from) * ROW
        const { label, fs, w } = fitLabel(name, size - 2 * BAND_PAD, fsNum, 0.7)
        shapes.push(rectShape(off, y0 + from * ROW, BAND, size, "color-group-border", 2, undefined,
            "color-group-box", 6))
        shapes.push(textShape(off + BAND / 2, y0 + from * ROW + size / 2, label, "middle", w,
            "color-group-name", fs, fs, { halo: false, upright: true }))
    }

    /*  the title of the rows and the name of the time unit in the corner,
        and the time axis above the chart: its tick labels with their tick
        marks  */
    if (caption !== undefined)
        shapes.push(textShape(hx + HEAD_PAD, hy + axisH / 2, caption, "start", textWidth(caption, fsNum, true),
            "color-container-name", "size-font-type", fsNum, { bold: true, halo: false }))
    if (unitName !== "")
        shapes.push(textShape(hx + rowW - HEAD_PAD, hy + axisH / 2, unitName, "end", textWidth(unitName, fsNum),
            "color-container-name", "size-font-type", fsNum, { halo: false }))
    shapes.push(rectShape(left, hy, width, axisH, "color-container-border", 1, undefined, "color-container-box", 6))
    for (let t = 0; t <= span; t += step) {
        shapes.push(textShape(xOf(t), hy + axisH / 2 - 2, String(t), "middle", textWidth(String(t), fsNum),
            "color-container-name", "size-font-type", fsNum, { halo: false }))
        shapes.push(pathShape(xOf(t), hy + axisH - 6, "v 6", [ 0, 0, 0, 6 ], "color-container-border", 1))
    }

    /*  the chart: the row backgrounds, the faint grid lines of the ticks,
        and the outlines of the clusters (on every nesting level)  */
    rows.forEach((_node, r) =>
        shapes.push(rectShape(left, y0 + r * ROW, width, ROW, "color-container-border", 1, undefined,
            "color-container-box")))
    if (height > 0)
        for (let t = 0; t <= span; t += step)
            shapes.push(pathShape(xOf(t), y0, `v ${height}`, [ 0, 0, 0, height ], "color-container-border", 1, "2 4"))
    for (const { from, to } of clusters)
        shapes.push(rectShape(left, y0 + from * ROW, width, (to - from) * ROW, "color-group-name", 3))

    /*  the bars of the tasks, the critical ones in the critical color (a
        milestone without duration as a dark grey diamond, in the colors of
        the pseudo-states of a "state" diagram, ringed if critical), each
        with its schedule as its tooltip and its slack (if any) as a dashed
        whisker from its earliest to its latest finish  */
    const diamond = (r: number) => `l ${r} ${-r} l ${r} ${r} l ${-r} ${r} z`
    for (const node of rows) {
        const t  = times.get(node.id)!
        const cy = cyOf(node.id)
        if (t.lf - t.ef > EPS) {
            const w = round(xOf(t.lf) - xOf(t.ef))
            shapes.push(pathShape(xOf(t.ef), cy, `h ${w}`, [ 0, 0, w, 0 ], "color-edge-line", 2, "4 4"))
            shapes.push(pathShape(xOf(t.lf), cy - BAR / 4, `v ${BAR / 2}`, [ 0, 0, 0, BAR / 2 ], "color-edge-line", 2))
        }
        const tip = `${node.name}\n` + (t.ef > t.es ?
            `earliest: ${fmt(t.es)} - ${fmt(t.ef)}\nlatest: ${fmt(t.ls)} - ${fmt(t.lf)}\n` :
            `milestone: earliest ${fmt(t.es)}, latest ${fmt(t.ls)}\n`) +
            `slack: ${fmt(t.ls - t.es)}${slackless(node.id) ? " (critical)" : ""}`
        const style = defaultStyleOf(node)
        const [ fill, stroke ]: ConfigEmbedded[] = critical(node.id) ?
            [ "color-mark-critical", "color-mark-critical" ] : [ style.fill, style.stroke ]
        const w = round(xOf(t.ef) - xOf(t.es))
        if (w > 0)
            shapes.push({ ...rectShape(xOf(t.es), cy - BAR / 2, w, BAR, stroke, 2, undefined, fill, Math.min(4, w / 2)),
                title: tip })
        else {
            if (critical(node.id))
                shapes.push(pathShape(xOf(t.es) - MILE - RING, cy, diamond(MILE + RING),
                    [ 0, -MILE - RING, (MILE + RING) * 2, MILE + RING ], "color-mark-critical", 2))
            shapes.push({ ...pathShape(xOf(t.es) - MILE, cy, diamond(MILE), [ 0, -MILE, MILE * 2, MILE ],
                "color-node-pseudo-border", 2, undefined, "color-node-pseudo-box"), title: tip })
        }
    }

    /*  the dependencies as orthogonal arrows from the end (finish) or start
        of the source bar (a milestone diamond: the tips of its ring) to the
        start or end of the target bar, leaving and entering each one
        outwards on its own track, the critical ones in the critical color,
        and a lag or lead labeled at the source  */
    const anchorOf = (id: string, atEnd: boolean): number => {
        const t   = times.get(id)!
        const tip = t.ef > t.es ? 0 : MILE + (critical(id) ? RING : 0)
        return atEnd ? xOf(t.ef) + tip : xOf(t.es) - tip
    }

    /*  the bars a vertical arrow segment crosses between two rows  */
    const crossings = (x: number, ra: number, rb: number): number => {
        let n = 0
        for (let r = Math.min(ra, rb) + 1; r < Math.max(ra, rb); r++)
            if (anchorOf(rows[r].id, false) <= x && x <= anchorOf(rows[r].id, true))
                n++
        return n
    }

    /*  the horizontal track of a backward arrow inside a row: in the free
        strip above or below its bar, off the row boundary (which may carry
        a cluster outline)  */
    const strip = (r: number, below: boolean, k: number) =>
        y0 + r * ROW + (below ? ROW - STRIP - Math.min(k, 2) * 2 : STRIP + Math.min(k, 2) * 2)

    /*  route every arrow, with the positions of its vertical segments still
        open (each with its feasible range, its preferred position, and the
        anchors it attaches to): an arrow leaving and entering on opposite
        sides turns outside both anchors, a forward arrow drops straight to
        its target (anywhere between its anchors, preferably where it crosses
        the fewest bars), and any other arrow loops through the free strip of
        a row (with a vertical segment outwards of each of its anchors)  */
    const verticals: Vertical[] = []
    const routes = arrows.map((a, route) => {
        const { edge, fromEnd, toStart } = a
        const [ d1, d2 ] = [ fromEnd ? 1 : -1, toStart ? 1 : -1 ]
        const [ rs, rt ] = [ rowOf.get(edge.source)!, rowOf.get(edge.target)! ]
        const [ x1, y1 ] = [ anchorOf(edge.source, fromEnd), cyOf(edge.source) ]
        const [ x2, y2 ] = [ anchorOf(edge.target, !toStart), cyOf(edge.target) ]
        const [ sk, tk ] = [ `${edge.source}:${fromEnd}`, `${edge.target}:${!toStart}` ]
        const ax = x1 + d1 * STUB
        const bx = x2 - d2 * (STUB + ARROW)
        const cx = d1 > 0 ? Math.min(ax, x2 - ARROW - APPROACH) : Math.max(ax, x2 + ARROW + APPROACH)
        const add = (pref: number, out: number, ya: number, yb: number, keys: string[], lo?: number, hi?: number) => {
            const v = { route, pref, ya: Math.min(ya, yb), yb: Math.max(ya, yb), keys, x: pref,
                lo: lo ?? (out > 0 ? pref : -Infinity), hi: hi ?? (out > 0 ? Infinity : pref) }
            verticals.push(v)
            return v
        }
        let gy = y2
        let vs: Vertical[]
        if (d1 !== d2)
            vs = [ add(d1 > 0 ? Math.max(ax, bx) : Math.min(ax, bx), d1, y1, y2, [ sk, tk ]) ]
        else if ((cx - x1) * d1 >= APPROACH) {
            const pref = (bx - cx) * d1 >= 0 && crossings(bx, rs, rt) < crossings(cx, rs, rt) ? bx : cx
            const [ lo, hi ] = [ x1 + d1 * APPROACH, x2 - d1 * (ARROW + APPROACH) ].sort((p, q) => p - q)
            vs = [ add(pref, d1, y1, y2, [ sk, tk ], lo, hi) ]
        }
        else {
            gy = crossings(bx, rs, rt) < crossings(ax, rs, rt) ?
                strip(rs, y2 > y1, ks.get(a)!) : strip(rt, y2 < y1, kt.get(a)!)
            vs = [ add(ax, d1, y1, gy, [ sk ]), add(bx, -d2, gy, y2, [ tk ]) ]
        }
        return { edge, d1, d2, x1, y1, x2, y2, gy, vs }
    })

    /*  place the vertical segments (see placeVerticals)  */
    placeVerticals(verticals)

    /*  draw the arrows, the critical ones last, staying on top where they
        join another arrow  */
    const onPath = (edge: Edge) => tight.has(edge) && critical(edge.source) && critical(edge.target)
    for (const { edge, d1, d2, x1, y1, x2, y2, gy, vs } of
        routes.slice().sort((p, q) => Number(onPath(p.edge)) - Number(onPath(q.edge)))) {
        const points: [ number, number ][] = [ [ x1, y1 ] ]
        if (vs.length === 1)
            points.push([ vs[0].x, y1 ], [ vs[0].x, y2 ])
        else
            points.push([ vs[0].x, y1 ], [ vs[0].x, gy ], [ vs[1].x, gy ], [ vs[1].x, y2 ])
        points.push([ x2 - d2 * ARROW, y2 ])
        const d  = points.slice(1).map(([ x, y ], i) =>
            x !== points[i][0] ? `h ${round(x - points[i][0])}` : `v ${round(y - points[i][1])}`).join(" ")
        const xs = points.map(([ x ]) => x - x1)
        const ys = points.map(([ , y ]) => y - y1)
        const color: ConfigEmbedded = onPath(edge) ? "color-mark-critical" : "color-edge-line"
        shapes.push(pathShape(x1, y1, d, [ Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys) ],
            color, 2))
        shapes.push(pathShape(x2, y2, `l ${-d2 * ARROW} ${-ARROW / 2} v ${ARROW} z`,
            d2 > 0 ? [ -ARROW, -ARROW / 2, 0, ARROW / 2 ] : [ 0, -ARROW / 2, ARROW, ARROW / 2 ],
            color, 1, undefined, color))
        /*  label a lag or lead beside the longest vertical segment of its
            arrow (on the side facing away from its source), on the row
            boundary closest to its middle (the free gap between the bars of
            two rows) if the segment clearly spans one, else at its middle,
            clear of the crowded bar ends  */
        const lag = lagOf(edge)
        if (lag !== 0) {
            const label = lag > 0 ? `+${fmt(lag)}` : `−${fmt(-lag)}`
            const [ vx, ya, yb ] = points.slice(1).reduce<[ number, number, number ]>((best, [ x, y ], i) =>
                x === points[i][0] && Math.abs(y - points[i][1]) > Math.abs(best[2] - best[1]) ?
                    [ x, Math.min(y, points[i][1]), Math.max(y, points[i][1]) ] : best, [ x1, y1, y1 ])
            const mid = (ya + yb) / 2
            const by  = y0 + Math.round((mid - y0) / ROW) * ROW
            const ly  = by > ya + ROW / 4 && by < yb - ROW / 4 ? by : mid
            shapes.push(textShape(vx + d1 * 4, ly, label, d1 > 0 ? "start" : "end", textWidth(label, fsLag),
                color, "size-font-edge", fsLag))
        }
    }

    /*  hand over the shapes for SVG rendering (no node boxes and edges)  */
    return { nodes: [], edges: [], cx: () => 0, cy: () => 0,
        boxW: new Map(), boxH: new Map(), contentH: new Map(), polys: [], shapes }
}

