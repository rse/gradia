/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node, Edge }                        from "./gradia-api-model.js"
import { Config }                            from "./gradia-api-config.js"
import { ARITY_OFF, textWidth, arrowRoom, stubRoom }
    from "./gradia-api-render-base.js"
import { LevelContext, GateSide }            from "./gradia-api-render-container.js"
import { Side, portGapOf, PORT_PAD }         from "./gradia-api-render-port.js"

/*  channel/gutter geometry constants  */
export const CHAN_W0  = 24  /*  width of an edge-less inter-column channel  */
export const CHAN_W1  = 28  /*  width of a one-edge inter-column channel    */
export const CHAN_PAD = 16  /*  cross-axis padding inside a channel         */
const CHAN_LBL        = 8   /*  padding beside an edge label in a channel   */
export const GUT_H0   = 20  /*  height of an edge-less inter-row gutter     */
export const GUT_H1   = 24  /*  height of a one-edge inter-row gutter       */
export const GUT_PAD  = 12  /*  cross-axis padding inside a gutter          */
export const GUT_LBL  = 22  /*  clearance above/below a label in a gutter   */
export const LOOP_TOP = 52  /*  detour of a self-loop above its node box    */

/*  the coarse route of an edge: the inter-column channels and the
    inter-row gutters it occupies, per channel the way it passes
    through it (mirrored: entering from the right side, hairpin:
    leaving on the very side it entered from), and the end lying in
    the gutter: an edge reaching its gate node through a gutter ends
    there, straight through the gate-side channel, instead of climbing
    back into the row of the gate  */
export interface RoutePlan {
    chans: number[]
    guts:  number[]
    flags: { mirror: boolean, hairpin: boolean }[]
    gate?: "s" | "t"
}

/*  the merged edge ends: the key of the bundle whose edges run into
    their target node, or out of their source node, as one, merging
    their edge ends at that node into one port  */
export type Merge = (edge: number, role: "s" | "t") => string | undefined

/*  the channels an edge runs a vertical track in (the gate-side
    channel of a gutter-ending edge is merely crossed horizontally)  */
const trackChans = (plan: RoutePlan): number[] =>
    plan.gate === "t" ? [ plan.chans[0] ] : plan.gate === "s" ? [ plan.chans[1] ] : plan.chans

/*  the channel an edge finally runs its stub out of into its target
    node, and whether that node lies right of the channel (a self-loop
    and a gutter-ending edge end in no such stub)  */
export const arrivalOf = (edge: Edge, plan: RoutePlan): { chan: number, right: boolean } | undefined => {
    if (edge.source === edge.target || plan.gate !== undefined)
        return undefined
    const flag = plan.flags[plan.flags.length - 1]
    return { chan: plan.chans[plan.chans.length - 1], right: flag.mirror === flag.hairpin }
}

/*  plan the coarse route of every edge: which inter-column channels
    and inter-row gutters it occupies (based on the grid indices and
    the attachment sides only): the source stub reaches the channel
    beside its attachment side, the target stub the channel beside
    its one, and, if those differ, the gutter next to the target row
    connects them (an edge whose gate end lies beyond that gutter ends
    in the gutter itself, as the gate merely marks the border passage)  */
export const planRoutes = (
    edges:  Edge[],
    col:    Map<string, number>,
    row:    Map<string, number>,
    sides:  { s: Side, t: Side }[],
    gates:  Map<string, GateSide>,
    config: Config
): { plans: RoutePlan[], chanCnt: Map<number, number>, gutCnt: Map<number, number>,
    chanLbl: Map<number, number>, gutLbl: Map<number, number>, gutLoop: Map<number, number> } => {
    const flag = (from: "l" | "r", to: "l" | "r") =>
        ({ mirror: from === "r", hairpin: from === to })
    const plans = edges.map((edge, i): RoutePlan => {
        /*  a self-loop detours as a hairpin through the channel beside
            its own node box (in from the near side and out on it again)  */
        const sc = col.get(edge.source)!
        if (edge.source === edge.target)
            return { chans: [ sc ], guts: [], flags: [ flag("l", "l") ] }
        const tc = col.get(edge.target)!
        const sr = row.get(edge.source)!
        const tr = row.get(edge.target)!
        const sChan = sides[i].s === "e" ? sc : sc - 1
        const tChan = sides[i].t === "w" ? tc - 1 : tc
        const sFrom = sides[i].s === "e" ? "l" : "r"
        const tTo   = sides[i].t === "w" ? "r" : "l"
        if (sChan === tChan)
            return { chans: [ sChan ], guts: [], flags: [ flag(sFrom, tTo) ] }
        const dir  = tChan > sChan ? "r" : "l"
        const gate = gates.has(edge.target) ? "t" : gates.has(edge.source) ? "s" : undefined
        return {
            chans: [ sChan, tChan ],
            guts:  [ tr > sr ? tr - 1 : tr ],
            flags: [ flag(sFrom, dir), flag(dir === "r" ? "l" : "r", tTo) ],
            gate
        }
    })

    /*  count the edges occupying each channel and gutter and determine
        the room the edge labels need there: a name is placed on the stub
        its edge finally runs into the target node, beside its arity (see
        "stubRoom"), or, for an edge ending in a gutter, along its gutter
        run, costing one label line there; an arity is always
        placed in the channel through which its edge finally approaches
        the target node, set back from the arrow head (the labels of a
        self-loop land on its detour above the box and need no room)  */
    const chanCnt  = new Map<number, number>()
    const gutCnt   = new Map<number, number>()
    const chanLbl  = new Map<number, number>()
    const gutLbl   = new Map<number, number>()
    const chanArr  = new Map<number, [ number, number ]>()
    const chanNeed = (c: number, width: number) =>
        chanLbl.set(c, Math.max(chanLbl.get(c) ?? 0, width))
    plans.forEach((plan, i) => {
        const chans = trackChans(plan)
        for (const c of chans)
            chanCnt.set(c, (chanCnt.get(c) ?? 0) + 1)
        for (const g of plan.guts)
            gutCnt.set(g, (gutCnt.get(g) ?? 0) + 1)
        const { name, arity, source, target } = edges[i]
        if (source === target)
            return
        const arrival = arrivalOf(edges[i], plan)
        if (name !== undefined && arrival !== undefined) {
            const room = chanArr.get(arrival.chan) ?? [ 0, 0 ]
            room[arrival.right ? 1 : 0] = Math.max(room[arrival.right ? 1 : 0], stubRoom(edges[i], config))
            chanArr.set(arrival.chan, room)
        }
        else if (name !== undefined && plan.guts.length > 0)
            gutLbl.set(plan.guts[0], (gutLbl.get(plan.guts[0]) ?? 0) + 1)
        if (arity !== undefined)
            chanNeed(chans[chans.length - 1],
                ARITY_OFF + textWidth(arity, config["size-font-arity"]) + CHAN_LBL)
    })
    for (const [ c, [ left, right ] ] of chanArr)
        chanNeed(c, Math.max(left, arrowRoom(config)) + Math.max(right, arrowRoom(config)) +
            ((chanCnt.get(c) ?? 1) - 1) * config["size-edge-track-gap"])

    /*  count the self-loops of every node, as their detours stack up
        above its box and have to fit into the gutter above its row
        (the demand of a gutter is the deepest stack of any node below it)  */
    const loopCnt = new Map<string, number>()
    const gutLoop = new Map<number, number>()
    for (const edge of edges.filter((edge) => edge.source === edge.target)) {
        const cnt = (loopCnt.get(edge.source) ?? 0) + 1
        loopCnt.set(edge.source, cnt)
        const g = row.get(edge.source)! - 1
        gutLoop.set(g, Math.max(gutLoop.get(g) ?? 0, cnt))
    }
    return { plans, chanCnt, gutCnt, chanLbl, gutLbl, gutLoop }
}

/*  determine the attachment sides of every edge, derived from the
    column relation of its endpoint nodes (a self-loop leaves on the
    east side and re-enters on the north side of its own box), except
    for an edge end attaching at a fixed port of a container box,
    which always uses the side of the inner gate: the west side
    when entering the container, the east side when leaving it  */
export const attachSides = (
    edges: Edge[],
    col:   Map<string, number>,
    level: LevelContext
): { s: Side, t: Side }[] =>
    edges.map((edge, i) => {
        const sc = col.get(edge.source)!
        const tc = col.get(edge.target)!
        if (edge.source === edge.target)
            return { s: "e", t: "n" }
        const s: Side = level.fixedPort?.(i, "s") !== undefined ? "e" : sc <= tc ? "e" : "w"
        const t: Side = level.fixedPort?.(i, "t") !== undefined ? "w" : sc <  tc ? "w" : "e"
        return { s, t }
    })

/*  grow every box up to the height hosting all of its edge
    attachments at the full port separation, and the one whose
    attachments exceed the configured per-side maximum additionally
    step-wise by one separation per additional edge, so the ports of a
    node never pack tighter than configured, however small its content
    height is (the fixed-size boxes of a containment level are exempt)  */
export const growBoxes = (
    nodes:   Node[],
    edges:   Edge[],
    sides:   { s: Side, t: Side }[],
    boxH:    Map<string, number>,
    config:  Config,
    level:   LevelContext,
    merged?: Merge
): void => {
    const portGap = portGapOf(edges, sides, config, merged)
    const portCnt = new Map<string, number>()
    edges.forEach((edge, i) => {
        for (const key of [ `${sides[i].s}:${edge.source}`, `${sides[i].t}:${edge.target}` ])
            portCnt.set(key, (portCnt.get(key) ?? 0) + 1)
    })

    /*  count the edge ends merged into one port as one  */
    if (merged !== undefined) {
        const seen = new Set<string>()
        edges.forEach((edge, i) => {
            for (const [ role, id ] of [ [ "s", edge.source ], [ "t", edge.target ] ] as const) {
                const m = merged(i, role)
                if (m === undefined)
                    continue
                const key = `${sides[i][role]}:${id}`
                if (seen.has(m))
                    portCnt.set(key, portCnt.get(key)! - 1)
                else
                    seen.add(m)
            }
        })
    }
    for (const node of nodes) {
        if (level.fixedSize?.has(node.id))
            continue
        let [ extra, full ] = [ 0, 0 ]
        for (const side of [ "w", "e" ] as const) {
            const cnt = portCnt.get(`${side}:${node.id}`) ?? 0
            const gap = portGap(node.id, side)
            extra = Math.max(extra, Math.max(0, cnt - config["graph-node-degree-max"]) * gap)
            full  = Math.max(full,  cnt * gap)
        }
        boxH.set(node.id, Math.max(boxH.get(node.id)! + extra, full + PORT_PAD))
    }
}

