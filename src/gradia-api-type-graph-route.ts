/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Edge }                        from "./gradia-api-model.js"
import { Config }                            from "./gradia-api-config.js"
import { Poly, arrowRoom, stubRoom, pushTo } from "./gradia-api-render-base.js"
import { LevelContext }                      from "./gradia-api-render-container.js"
import { Side, assignPorts, portGapOf }      from "./gradia-api-render-port.js"
import { TrackUser, assignTracks }           from "./gradia-api-render-track.js"
import { simplifyPoly, computeHops }         from "./gradia-api-render-path.js"
import { RoutePlan, Merge, arrivalOf, CHAN_W1, CHAN_PAD, GUT_H0, GUT_H1, GUT_PAD, LOOP_TOP }
    from "./gradia-api-type-graph-plan.js"
import { Grid, Need }                        from "./gradia-api-type-graph-grid.js"

/*  node nudging constants  */
const NUDGE_GAP    = 24  /*  min port distance of a nudged node from its gutter tracks  */
const NUDGE_PASSES = 3   /*  max number of node nudging passes                          */
const NUDGE_EDGES  = 300 /*  max number of edges for which nodes are nudged at all      */

/*  the bundle keys of an edge: the edges of the same name leading to
    the same target node side with the same arity, or coming from the
    same source node side (directly, or else through the given gutter),
    keeping the marked edges apart from the unmarked ones  */
export const targetKey = (c: number, edge: Edge, marked = false, via?: number): string =>
    `t:${c}:${via ?? ""}:${JSON.stringify([ edge.target, edge.arity ?? null, edge.name ?? null ])}` +
    (marked ? ":marked" : "")
export const sourceKey = (c: number, edge: Edge, marked = false, via?: number): string =>
    `s:${c}:${via ?? ""}:${JSON.stringify([ edge.source, edge.name ?? null ])}` +
    (marked ? ":marked" : "")

/*  assign the parallel tracks within the channels and gutters and derive
    the resulting track coordinate functions (see assignTracks for the
    crossing-avoiding ordering scheme, with backward edges entering the
    channel mirrored from the right side; the gutters use the very same
    scheme, just transposed: edges dropping in from above enter from the
    near side, edges rising from below are the mirrored users), together
    with the needs of the crowded channels and gutters and the edges
    bundled within the channels (with the key of their bundle, by the
    channel and the edge)  */
const assignTrackCoords = (
    edges:   Edge[],
    plans:   RoutePlan[],
    portPos: Map<string, { x: number, y: number }>,
    grid:    Grid,
    config:  Config,
    merged?: Merge,
    markOf?: (edge: Edge) => boolean,
    distinct = false,
    fixed?:  (edge: number) => boolean
): { chanX: (c: number, edge: number) => number, gutY: (g: number, edge: number) => number,
    need: Need, bundled: Set<number>, keys: Map<string, string> } => {
    const { colWidth, chanCap, gutCap, chanW, colCX } = grid
    const gutBase = (g: number) => grid.gutCY[g]
    const gap     = config["size-edge-track-gap"]
    const need: Need = { chan: new Map<number, number>(), gut: new Map<number, number>() }
    const bundled    = new Set<number>()
    const keys       = new Map<string, string>()

    /*  the bundle keys of an edge (kept apart per edge for distinct
        edges and for the edges attaching at a fixed port, which are
        hence never bundled: the former by request, the latter as they
        continue into a container as separate edges, so a shared track
        would hide which port connects to which)  */
    const keysOf = (i: number, tk: string, sk: string): string[] =>
        distinct || fixed?.(i) === true ? [ `${tk}:${i}`, `${sk}:${i}` ] : [ tk, sk ]

    /*  assign the vertical tracks within the inter-column channels (the
        leg of a self-loop spans up to its detour above the box, and a
        gutter-ending edge takes no track in its gate-side channel), with
        the self-loops never bundled, as their detours would coincide, and
        the edges with merged ports bound to their bundle beside the port  */
    const chanUsers = new Map<number, TrackUser[]>()
    edges.forEach((edge, i) => {
        const { chans, guts, flags, gate } = plans[i]
        const sp   = portPos.get(`${i}:s`)!
        const tp   = portPos.get(`${i}:t`)!
        const tEnd = merged?.(i, "t")
        const sEnd = merged?.(i, "s")
        const mark = markOf?.(edge) === true
        if (edge.source === edge.target)
            pushTo(chanUsers, chans[0], { edge: i, posIn: sp.y, posOut: tp.y - LOOP_TOP, ...flags[0] })
        else if (chans.length === 1)
            pushTo(chanUsers, chans[0], { edge: i, posIn: sp.y, posOut: tp.y, ...flags[0],
                bundles: keysOf(i, targetKey(chans[0], edge, mark), sourceKey(chans[0], edge, mark)),
                unit: tEnd ?? sEnd })
        else {
            const gy = gutBase(guts[0])
            if (gate !== "s")
                pushTo(chanUsers, chans[0], { edge: i, posIn: sp.y, posOut: gy,   ...flags[0],
                    bundles: keysOf(i, targetKey(chans[1], edge, mark, guts[0]), sourceKey(chans[0], edge, mark)),
                    unit: sEnd })
            if (gate !== "t")
                pushTo(chanUsers, chans[1], { edge: i, posIn: gy,   posOut: tp.y, ...flags[1],
                    bundles: keysOf(i, targetKey(chans[1], edge, mark), sourceKey(chans[0], edge, mark, guts[0])),
                    unit: tEnd })
        }
    })
    const chanOff = new Map<string, number>()
    const shift   = new Map<number, number>()
    const frame   = Math.max(CHAN_W1, 2 * arrowRoom(config))
    for (const [ c, users ] of chanUsers) {
        /*  a channel holding a bundle running through one merged port keeps
            that run long enough for the labels of the bundle placed there  */
        const reach  = users.reduce((max, u) =>
            u.unit !== undefined ? Math.max(max, 2 * stubRoom(edges[u.edge], config)) : max, frame)
        const tracks = assignTracks(users, chanCap[c], CHAN_PAD, gap, reach)
        for (const [ edge, off ] of tracks.offsets)
            chanOff.set(`${c}:${edge}`, off)
        if (tracks.need > 0)
            need.chan.set(c, tracks.need)
        for (const [ edge, key ] of tracks.bundled) {
            bundled.add(edge)
            keys.set(`${c}:${edge}`, key)
        }

        /*  shift the tracks away from the side whose arriving stubs lack the
            room of their name and arity labels (see "stubRoom"), as far as
            the other side keeps its own room, or, if both lack it, split the
            lack between them, but never push a track out of the arrow room
            of either side; the stubs of a bundle merged into one port count,
            too, the other bundled edges not, as their names sit on the
            stubs feeding their shared track  */
        const room: [ number, number ] = [ arrowRoom(config), arrowRoom(config) ]
        for (const u of users) {
            const edge    = edges[u.edge]
            const arrival = arrivalOf(edge, plans[u.edge])
            if (edge.name === undefined)
                continue
            if (arrival?.chan === c && (!tracks.bundled.has(u.edge) || merged?.(u.edge, "t") !== undefined))
                room[arrival.right ? 1 : 0] = Math.max(room[arrival.right ? 1 : 0], stubRoom(edge, config))
            if (plans[u.edge].chans[0] === c && merged?.(u.edge, "s") !== undefined)
                room[plans[u.edge].flags[0].mirror ? 1 : 0] =
                    Math.max(room[plans[u.edge].flags[0].mirror ? 1 : 0], stubRoom(edge, config))
        }
        const offs = users.map((u) => tracks.offsets.get(u.edge)!)
        const lo   = room[0] - chanW[c] / 2 - Math.min(...offs)
        const hi   = chanW[c] / 2 - room[1] - Math.max(...offs)
        const min  = arrowRoom(config) - chanW[c] / 2 - Math.min(...offs)
        const max  = chanW[c] / 2 - arrowRoom(config) - Math.max(...offs)
        shift.set(c, lo <= hi ? Math.min(Math.max(0, lo), hi) :
            min <= max ? Math.min(Math.max((lo + hi) / 2, min), max) : (min + max) / 2)
    }
    const chanX = (c: number, edge: number) => colCX[c] + colWidth[c] / 2 + chanW[c] / 2 +
        shift.get(c)! + chanOff.get(`${c}:${edge}`)!

    /*  assign the horizontal tracks within the inter-row gutters (the
        run of a gutter-ending edge extends up to its gate, where its
        stub continues straight and hence crosses no other track)  */
    const gutUsers = new Map<number, TrackUser[]>()
    edges.forEach((edge, i) => {
        const { chans, guts, gate } = plans[i]
        if (guts.length === 0)
            return
        const sp   = portPos.get(`${i}:s`)!
        const tp   = portPos.get(`${i}:t`)!
        const mark = markOf?.(edge) === true
        pushTo(gutUsers, guts[0], {
            edge:    i,
            posIn:   gate === "s" ? sp.x : chanX(chans[0], i),
            posOut:  gate === "t" ? tp.x : chanX(chans[1], i),
            mirror:  sp.y > gutBase(guts[0]),
            bundles: keysOf(i, targetKey(chans[1], edge, mark), sourceKey(chans[0], edge, mark))
        })
    })
    const gutOff = new Map<string, number>()
    for (const [ g, users ] of gutUsers) {
        const tracks = assignTracks(users, gutCap[g], GUT_PAD, gap, GUT_H1)
        for (const [ edge, off ] of tracks.offsets)
            gutOff.set(`${g}:${edge}`, off)
        if (tracks.need > 0)
            need.gut.set(g, tracks.need)
        for (const edge of tracks.bundled.keys())
            bundled.add(edge)
    }
    const gutY = (g: number, edge: number) => gutBase(g) + gutOff.get(`${g}:${edge}`)!
    return { chanX, gutY, need, bundled, keys }
}

/*  route every edge as an orthogonal polyline through the channels
    between columns and the gutters between rows  */
const routePolys = (
    edges:   Edge[],
    plans:   RoutePlan[],
    portPos: Map<string, { x: number, y: number }>,
    boxH:    Map<string, number>,
    cy:      (id: string) => number,
    chanX:   (c: number, edge: number) => number,
    gutY:    (g: number, edge: number) => number
): Poly[] => {
    /*  the innermost channel track among the self-loops of each node  */
    const loopX = new Map<string, number>()
    edges.forEach((edge, i) => {
        if (edge.source === edge.target)
            loopX.set(edge.source, Math.min(loopX.get(edge.source) ?? Infinity, chanX(plans[i].chans[0], i)))
    })
    return edges.map((edge, i) => {
        const sp = portPos.get(`${i}:s`)!
        const tp = portPos.get(`${i}:t`)!
        const { chans, guts, flags, gate } = plans[i]
        let pts: Poly
        if (edge.source === edge.target) {
            /*  route the self-loop counter-clockwise around the top-right
                box corner: out on the east side, up along its channel
                track, back left above the box, and down into the north
                side again (the detour above the box is the wider one, as
                its final descent has to stay readable behind the arrow
                head, and grows with the track distance from the innermost
                loop of the node, so the nested loops stay apart)  */
            const ox  = chanX(chans[0], i)
            const oy  = cy(edge.source) - boxH.get(edge.source)! / 2 - LOOP_TOP - (ox - loopX.get(edge.source)!)
            pts = [ [ sp.x, sp.y ], [ ox, sp.y ], [ ox, oy ], [ tp.x, oy ], [ tp.x, tp.y ] ]
        }
        else if (chans.length === 1) {
            const ch = chanX(chans[0], i)
            if (!flags[0].hairpin && sp.y === tp.y)
                pts = [ [ sp.x, sp.y ], [ tp.x, tp.y ] ]
            else
                pts = [ [ sp.x, sp.y ], [ ch, sp.y ], [ ch, tp.y ], [ tp.x, tp.y ] ]
        }
        else {
            /*  a gutter-ending edge leaves the gutter straight into its
                gate instead of turning into the gate-side channel  */
            const ch1 = gate === "s" ? sp.x : chanX(chans[0], i)
            const ch2 = gate === "t" ? tp.x : chanX(chans[1], i)
            const gy  = gutY(guts[0], i)
            if (gate === "t")
                pts = [ [ sp.x, sp.y ], [ ch1, sp.y ], [ ch1, gy ], [ tp.x, gy ] ]
            else if (gate === "s")
                pts = [ [ sp.x, gy ], [ ch2, gy ], [ ch2, tp.y ], [ tp.x, tp.y ] ]
            else
                pts = [ [ sp.x, sp.y ], [ ch1, sp.y ], [ ch1, gy ], [ ch2, gy ], [ ch2, tp.y ], [ tp.x, tp.y ] ]
        }
        return simplifyPoly(pts)
    })
}

/*  the routing of all edges: the attachment ports, the gutter track
    positions, the polylines, the needs of the crowded channels and
    gutters (and whether the grid fulfills them), the edges bundled
    within them (with the keys of their bundles in the channels, see
    assignTrackCoords), and the number of crossings between them
    (determined on demand only, as merely the node nudging needs it)  */
export interface Routing {
    portPos: Map<string, { x: number, y: number }>
    gutY:    (g: number, edge: number) => number
    polys:   Poly[]
    need:    Need
    fits:    boolean
    bundled: Set<number>
    keys:    Map<string, string>
    hops:    () => number
}

/*  route every edge for the given node positions: distribute the
    attachment ports along each node side and assign the parallel tracks
    within the channels and gutters, provisionally, to learn the gutter
    track every edge follows, then re-distribute the ports with every
    gutter-routed edge ordered by its actual gutter track approach
    instead of the opposite node position (which can disagree and would
    cross the edges right in front of their attachments), re-assign the
    tracks on top of the moved ports and finally route every edge as an
    orthogonal polyline through the channels between the columns and
    the gutters between the rows  */
export const routeEdges = (
    edges:   Edge[],
    plans:   RoutePlan[],
    sides:   { s: Side, t: Side }[],
    boxW:    Map<string, number>,
    boxH:    Map<string, number>,
    cx:      (id: string) => number,
    cy:      (id: string) => number,
    grid:    Grid,
    config:  Config,
    level:   LevelContext,
    merged?: Merge,
    markOf?: (edge: Edge) => boolean,
    distinct = false
): Routing => {
    const portGap  = portGapOf(edges, sides, config, merged)
    const fixed    = (edge: number): boolean =>
        level.fixedPort?.(edge, "s") !== undefined || level.fixedPort?.(edge, "t") !== undefined
    const portPre  = assignPorts(edges, sides, cx, cy, boxW, boxH, portGap,
        undefined, level.fixedPort, merged)
    const trackPre = assignTrackCoords(edges, plans, portPre, grid, config, merged, markOf, distinct, fixed)
    const portPos  = assignPorts(edges, sides, cx, cy, boxW, boxH, portGap,
        (edge) => plans[edge].guts.length > 0 ?
            trackPre.gutY(plans[edge].guts[0], edge) : undefined, level.fixedPort, merged)
    const { chanX, gutY, need, bundled, keys } = assignTrackCoords(edges, plans, portPos, grid, config,
        merged, markOf, distinct, fixed)
    const polys = routePolys(edges, plans, portPos, boxH, cy, chanX, gutY)
    const fits  = Array.from(need.chan).every(([ c, w ]) => w <= grid.chanW[c])
        && Array.from(need.gut).every(([ g, h ]) => h <= grid.gutH[g])
    let   count: number | undefined
    const hops  = (): number => {
        count ??= computeHops(polys).reduce((sum, segs) =>
            sum + Array.from(segs.values()).reduce((n, xs) => n + xs.length, 0), 0)
        return count
    }
    return { portPos, gutY, polys, need, fits, bundled, keys, hops }
}

/*  nudge nodes vertically off their row centers to straighten the
    direct edges to their same-row neighbors in the adjacent columns, as
    far as this improves the overall routing (fewer crossings, or as many
    crossings but fewer jogged direct edges): a node may leave its row
    band into an adjacent gutter only as far as no gutter track runs
    across its column and no self-loop detours through it there (a loop
    rises above the box of its node), and only as long as its own
    gutter-routed edges keep approaching it from their gutter side and
    the tracks of the crowded channels and gutters keep fitting in  */
export const nudgeNodes = (
    nodes:  Node[],
    edges:  Edge[],
    plans:  RoutePlan[],
    col:    Map<string, number>,
    row:    Map<string, number>,
    boxH:   Map<string, number>,
    grid:   Grid,
    nrows:  number,
    dy:     Map<string, number>,
    route:  () => Routing,
    first:  Routing
): Routing => {
    /*  skip the nudging on large graphs, as every tried shift re-routes
        all edges, so its effort grows with the node count times the
        edge count, while it only straightens a few direct edges  */
    if (edges.length > NUDGE_EDGES)
        return first

    /*  whether neither a gutter track nor a self-loop detour crosses a column within a gutter  */
    const gutterFree = (g: number, c: number): boolean =>
        !plans.some((plan) => plan.guts[0] === g
            && Math.min(...plan.chans) < c
            && c <= Math.max(...plan.chans) + (plan.gate === "t" ? 1 : 0))
        && !edges.some((edge) => edge.source === edge.target
            && row.get(edge.source) === g + 1 && col.get(edge.source) === c)

    /*  the vertical shift range of a node: its row slack plus the room of its free adjacent gutters  */
    const shiftRange = (id: string): [ number, number ] => {
        if (grid.room !== undefined)
            return grid.room.get(id)!
        const r     = row.get(id)!
        const c     = col.get(id)!
        const slack = (grid.rowHeight[r] - boxH.get(id)!) / 2
        const up    = r > 0         && gutterFree(r - 1, c) ? grid.gutH[r - 1] - GUT_H0 : 0
        const down  = r < nrows - 1 && gutterFree(r, c)     ? grid.gutH[r]     - GUT_H0 : 0
        return [ -(slack + up), slack + down ]
    }

    /*  whether the gutter-routed edges of a node still approach it from their gutter side  */
    const below = (id: string, g: number): boolean =>
        grid.nodeCY !== undefined ? grid.nodeCY.get(id)! > grid.gutCY[g] : row.get(id)! > g
    const approachesSanely = (id: string, routing: Routing): boolean =>
        edges.every((edge, i) => {
            const role = edge.source === id ? "s" : edge.target === id ? "t" : null
            if (role === null || plans[i].guts.length === 0)
                return true
            const g   = plans[i].guts[0]
            const gap = routing.portPos.get(`${i}:${role}`)!.y - routing.gutY(g, i)
            return below(id, g) ? gap >= NUDGE_GAP : gap <= -NUDGE_GAP
        })

    /*  rank the routings: fewer crossings first, then fewer jogged direct same-row edges  */
    const direct = edges.map((edge, i) => plans[i].chans.length === 1
        && !plans[i].flags[0].hairpin
        && row.get(edge.source) === row.get(edge.target))
    const jogs = (routing: Routing): number =>
        edges.filter((_, i) => direct[i]
            && routing.portPos.get(`${i}:s`)!.y !== routing.portPos.get(`${i}:t`)!.y).length
    const better = (a: Routing, b: Routing): boolean =>
        a.hops() < b.hops() || (a.hops() === b.hops() && jogs(a) < jogs(b))

    /*  try, in a few passes, for every node the shifts aligning one of
        its direct edges, and keep the best of the shifts improving the
        routing (all shifts are relative to the current position, which
        already includes the shifts of the previous passes)  */
    let current = first
    for (let pass = 0; pass < NUDGE_PASSES; pass++) {
        let changed = false
        for (const node of nodes) {
            const [ lo, hi ] = shiftRange(node.id)
            const shifts = new Set<number>()
            edges.forEach((edge, i) => {
                if (!direct[i])
                    return
                const sp = current.portPos.get(`${i}:s`)!
                const tp = current.portPos.get(`${i}:t`)!
                if (edge.source === node.id)
                    shifts.add(tp.y - sp.y)
                else if (edge.target === node.id)
                    shifts.add(sp.y - tp.y)
            })
            const base = dy.get(node.id) ?? 0
            let best: { offset: number, routing: Routing } | undefined
            for (const shift of shifts) {
                if (shift === 0 || base + shift < lo || base + shift > hi)
                    continue
                dy.set(node.id, base + shift)
                const routing = route()
                if (approachesSanely(node.id, routing) && routing.fits
                    && better(routing, best?.routing ?? current))
                    best = { offset: base + shift, routing }
            }
            dy.set(node.id, best?.offset ?? base)
            if (best !== undefined) {
                current = best.routing
                changed = true
            }
        }
        if (!changed)
            break
    }
    return current
}

