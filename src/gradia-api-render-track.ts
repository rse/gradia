/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  the minimum offset between the parallel tracks of a crowded
    channel/gutter, so its edge lines always stay visibly apart  */
const TRACK_GAP_MIN = 8

/*  a channel/gutter track user: an edge entering the channel/gutter at
    cross-axis position posIn and leaving it at posOut (mirrored users
    enter from the far instead of the near side, hairpin users leave
    on the very side they entered from), with the keys of the bundles
    it may join in a crowded channel/gutter (one per shared edge end),
    or the key of the bundle its port was merged into  */
export interface TrackUser {
    edge:     number
    posIn:    number
    posOut:   number
    mirror:   boolean
    hairpin?: boolean
    bundles?: string[]
    unit?:    string
}

/*  a track unit: one track user or a bundle of users sharing a track,
    with its mean entry/exit positions, its cross-axis span, and the
    near-side and far-side stub positions of all its users  */
interface TrackUnit {
    users:  TrackUser[]
    key?:   string
    posIn:  number
    posOut: number
    mirror: boolean
    lo:     number
    hi:     number
    nears:  number[]
    fars:   number[]
}

/*  the minimum cross-axis distance between the track-following segments
    of two edges sharing a track, keeping their rounded corners apart  */
const TRACK_CLEARANCE = 24

/*  the cross-axis positions of the stubs of a track user reaching the
    near side of the channel/gutter (its entering segment, or its
    exiting one if mirrored, or both if hairpin, or none if mirrored
    hairpin) and the far side  */
const nears = (u: TrackUser): number[] =>
    u.hairpin ? (u.mirror ? [] : [ u.posIn, u.posOut ]) : [ u.mirror ? u.posOut : u.posIn ]
const fars  = (u: TrackUser): number[] =>
    u.hairpin ? (u.mirror ? [ u.posIn, u.posOut ] : []) : [ u.mirror ? u.posIn : u.posOut ]

/*  the track unit of track users sharing one track  */
const unitOf = (users: TrackUser[], key?: string): TrackUnit => ({
    users,
    key,
    posIn:  users.reduce((sum, u) => sum + u.posIn,  0) / users.length,
    posOut: users.reduce((sum, u) => sum + u.posOut, 0) / users.length,
    mirror: users[0].mirror,
    lo:     Math.min(...users.map((u) => Math.min(u.posIn, u.posOut))),
    hi:     Math.max(...users.map((u) => Math.max(u.posIn, u.posOut))),
    nears:  users.flatMap(nears),
    fars:   users.flatMap(fars)
})

/*  the number of crossings caused by placing unit a on a nearer track
    than unit b: the far-side stubs of a (its exiting segment, or its
    entering one if mirrored) cross the track-following segment of b,
    and the near-side stubs of b cross the one of a (a stub touching
    the end of a segment counts too, as it would overlap a corner)  */
const trackCrossings = (a: TrackUnit, b: TrackUnit): number => {
    let n = 0
    for (const pos of a.fars)
        if (pos >= b.lo && pos <= b.hi)
            n++
    for (const pos of b.nears)
        if (pos >= a.lo && pos <= a.hi)
            n++
    return n
}

/*  the number of collinear overlaps caused by placing user a on a
    nearer track than user b: a far-side stub of a and a near-side stub
    of b at the very same cross-axis position run on top of each other
    between the two tracks (unlike a crossing, which is still readable
    through its hop, an overlap merges the two edges visually)  */
const trackOverlaps = (farsA: number[], nearsB: number[]): number => {
    let n = 0
    for (const pos of farsA)
        for (const near of nearsB)
            if (near === pos) {
                n++
                break
            }
    return n
}

/*  the maximum number of users for which the crossing-minimal track
    order is determined exactly (the effort doubles with every user)  */
const TRACK_EXACT_MAX = 14

/*  the maximum number of users for which the local search tries blocks
    of any length and restarts after every improving move (beyond it,
    the search is bounded to blocks of at most TRACK_BLOCK_MAX users and
    at most TRACK_PASSES_MAX passes, as the restarting search grows too
    fast with hundreds of users)  */
const TRACK_SEARCH_MAX = 100
const TRACK_BLOCK_MAX  = 8
const TRACK_PASSES_MAX = 100

/*  reorder the seeded track units to the order causing the fewest
    overlaps and then the fewest crossings, with ties broken toward the
    seed order: for small unit sets exactly, by a dynamic programming
    over the unit subsets (the linear ordering problem), for larger
    ones by a local search moving blocks of adjacent units while this
    reduces the overlaps/crossings  */
const minimizeCrossings = (seed: TrackUnit[]): TrackUnit[] => {
    const n = seed.length
    if (n < 2)
        return seed

    /*  the weighted cost of placing seed unit i before seed unit j: the
        overlaps dominate (one outweighs all crossings possible among the
        units, at most three per pair of single users, and at most the
        stubs of both units per pair of bundles), then the crossings,
        and finally a seed order inversion breaks ties (the flat matrix
        is a plain array, so its mostly small integers stay unboxed,
        unlike in a "Float64Array", whose doubles slow down the search)  */
    const stubs   = seed.reduce((sum, u) => sum + u.nears.length + u.fars.length, 0)
    const weight  = stubs > 2 * n ? 2 * stubs * stubs : 2 * n * n
    const cost: number[] = []
    for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
            cost.push((trackOverlaps(seed[i].fars, seed[j].nears) * weight +
                trackCrossings(seed[i], seed[j])) * n * n + (i > j ? 1 : 0))
    let order: number[]
    if (n <= TRACK_EXACT_MAX) {
        const best = new Float64Array(1 << n).fill(Infinity)
        const last = new Int8Array(1 << n)
        best[0] = 0
        for (let s = 1; s < (1 << n); s++) {
            for (let u = 0; u < n; u++) {
                if ((s & (1 << u)) === 0)
                    continue
                const rest = s & ~(1 << u)
                let total = best[rest]
                for (let v = 0; v < n; v++)
                    if ((rest & (1 << v)) !== 0)
                        total += cost[v * n + u]
                if (total < best[s]) {
                    best[s] = total
                    last[s] = u
                }
            }
        }
        order = []
        for (let s = (1 << n) - 1; s !== 0; s &= ~(1 << last[s]))
            order.unshift(last[s])
    }
    else {
        /*  move a block of adjacent users over the run of users behind
            or ahead of it, as soon as this reduces the cost (which only
            the pairs between the block and the run passed contribute
            to, so the cost change is accumulated while extending the
            run), until no such move remains (a single-user move is
            the block move of length one, while the longer blocks let
            a group of users pass an obstacle which none of its members
            could pass on their own); for large user sets the search is
            bounded instead: per block, the best move over the runs
            behind and ahead of it is applied, and the search continues
            with the next block instead of restarting  */
        order = seed.map((_, i) => i)

        /*  precompute the cost change of swapping two users once:
            diff[a * n + b] is the cost of placing user a before user b
            minus the cost of the reverse placement  */
        const diff: number[] = []
        for (let a = 0; a < n; a++)
            for (let b = 0; b < n; b++)
                diff.push(cost[a * n + b] - cost[b * n + a])
        const bounded = n > TRACK_SEARCH_MAX
        const maxLen  = bounded ? Math.min(n - 1, TRACK_BLOCK_MAX) : n - 1
        const passes  = bounded ? TRACK_PASSES_MAX : Infinity
        for (let improved = true, pass = 0; improved && pass < passes; pass++) {
            improved = false
            for (let len = 1; len <= maxLen; len++) {
                for (let i = 0; i + len <= n; i++) {
                    let best    = 0
                    let target  = -1
                    let forward = true
                    let delta   = 0
                    for (let k = i + len; k < n; k++) {
                        const row = order[k] * n
                        for (let b = i; b < i + len; b++)
                            delta += diff[row + order[b]]
                        if (delta < best) {
                            best    = delta
                            target  = k
                            forward = true
                            if (!bounded)
                                break
                        }
                    }
                    delta = 0
                    for (let k = i - 1; k >= 0; k--) {
                        if (target >= 0 && !bounded)
                            break
                        const other = order[k]
                        for (let b = i; b < i + len; b++)
                            delta += diff[order[b] * n + other]
                        if (delta < best) {
                            best    = delta
                            target  = k
                            forward = false
                            if (!bounded)
                                break
                        }
                    }
                    if (target >= 0) {
                        if (forward)
                            order.splice(target - len + 1, 0, ...order.splice(i, len))
                        else
                            order.splice(target, 0, ...order.splice(i, len))
                        improved = true
                        if (!bounded)
                            break
                    }
                }
                if (improved && !bounded)
                    break
            }
        }
    }
    return order.map((i) => seed[i])
}

/*  order the track units by their entry/exit positions, so that a
    track-following segment never has to cross the entering segment of
    a parallel neighbor (back turners get near tracks entry-position-
    ordered, forward turners far tracks, reversed for mirrored units
    which enter the channel/gutter from the far side), refine this seed
    order to the one causing the fewest crossings, and pack the ordered
    units onto tracks: overlapping units keep their relative
    crossing-avoiding order by always taking a farther track than every
    earlier overlapping unit, while span-disjoint units share a track
    (their entry/exit segments lie outside each other's span, so
    sharing can never introduce a crossing)  */
const packTracks = (units: TrackUnit[]): { trackOf: Map<TrackUnit, number>, tracks: number } => {
    const order = (list: TrackUnit[], mirror: boolean): TrackUnit[] => {
        const dir   = mirror ? -1 : +1
        const backs = list.filter((u) => u.posOut <  u.posIn)
            .sort((a, b) => dir * ((a.posIn - b.posIn) || (a.posOut - b.posOut)))
        const fores = list.filter((u) => u.posOut >= u.posIn)
            .sort((a, b) => dir * ((b.posIn - a.posIn) || (b.posOut - a.posOut)))
        return [ ...backs, ...fores ]
    }
    const ordered = minimizeCrossings([
        ...order(units.filter((u) => !u.mirror), false),
        ...order(units.filter((u) =>  u.mirror), true)
    ])
    const overlap = (a: TrackUnit, b: TrackUnit): boolean =>
        a.lo < b.hi + TRACK_CLEARANCE && b.lo < a.hi + TRACK_CLEARANCE
    const trackOf = new Map<TrackUnit, number>()
    let   tracks  = 0
    ordered.forEach((u, idx) => {
        let t = 0
        for (let j = 0; j < idx; j++)
            if (overlap(ordered[j], u))
                t = Math.max(t, trackOf.get(ordered[j])! + 1)
        trackOf.set(u, t)
        tracks = Math.max(tracks, t + 1)
    })
    return { trackOf, tracks }
}

/*  the maximum number of users whose spans (extended by the track
    clearance, exactly as the track packing compares them) overlap at
    one and the same position  */
const overlapDepth = (users: TrackUser[]): number => {
    const events: [ number, number ][] = []
    for (const u of users) {
        events.push([ Math.min(u.posIn, u.posOut), +1 ])
        events.push([ Math.max(u.posIn, u.posOut) + TRACK_CLEARANCE, -1 ])
    }
    events.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
    let depth = 0
    let max   = 0
    for (const [ , delta ] of events) {
        depth += delta
        max = Math.max(max, depth)
    }
    return max
}

/*  group the users of a crowded channel/gutter into bundles sharing a
    track: the users bound to a bundle form it first, then the bundle
    keys (qualified by the sides the users enter and leave on) are dealt
    out largest first, each to its users not yet dealt out, if at least
    two; all other users stay single, except a straight passing one,
    which needs no track and is dropped  */
const bundleUnits = (users: TrackUser[]): TrackUnit[] => {
    const members = new Map<string, TrackUser[]>()
    const add     = (key: string, u: TrackUser) => {
        const list = members.get(key)
        if (list === undefined)
            members.set(key, [ u ])
        else
            list.push(u)
    }
    for (const u of users) {
        if (u.unit !== undefined)
            add(`=:${u.unit}`, u)
        else
            for (const key of u.bundles ?? [])
                add(`${u.mirror ? "m" : "-"}${u.hairpin ? "h" : "-"}:${key}`, u)
    }
    const bound = (key: string) => key.startsWith("=:") ? 1 : 0
    const keys  = Array.from(members.keys()).sort((a, b) =>
        (bound(b) - bound(a)) || (members.get(b)!.length - members.get(a)!.length))
    const dealt = new Set<TrackUser>()
    const units: TrackUnit[] = []
    for (const key of keys) {
        const list = members.get(key)!.filter((u) => !dealt.has(u))
        if (list.length < (bound(key) ? 1 : 2))
            continue
        for (const u of list)
            dealt.add(u)
        units.push(unitOf(list, key.slice(key.indexOf(":") + 1)))
    }
    for (const u of users)
        if (!dealt.has(u) && (u.hairpin || u.posIn !== u.posOut))
            units.push(unitOf([ u ]))
    return units
}

/*  the assigned tracks of a channel/gutter: the offset of every user
    from its center, the size a crowded one needs (0 otherwise), and
    the bundled edges with their bundle keys  */
export interface TrackAssignment {
    offsets: Map<number, number>
    need:    number
    bundled: Map<number, string>
}

/*  assign the parallel tracks within a channel or gutter (see packTracks)
    and spread them centered within it. A crowded channel/gutter, whose
    tracks do not fit at the full track gap (or which has users bound to
    a bundle), bundles its users sharing an edge end onto one track each,
    spreads its tracks at least at the minimum track gap, and reports the
    size they need within the frame  */
export const assignTracks = (users: TrackUser[], width: number, pad: number, gap: number,
    frame: number): TrackAssignment => {
    /*  users overlapping at one position need own tracks in any order,
        so a deep enough overlap proves a crowded channel/gutter without
        determining its costly order  */
    const depth   = overlapDepth(users)
    const crowded = users.some((u) => u.unit !== undefined)
        || (gap > 0 && depth > 1 && depth > 1 + (width - pad) / gap)
    let   { trackOf, tracks } = crowded ? { trackOf: new Map<TrackUnit, number>(), tracks: 0 } :
        packTracks(users.map((u) => unitOf([ u ])))
    let   step    = Math.min(gap, (width - pad) / Math.max(tracks - 1, 1))
    let   need    = 0
    const bundled = new Map<number, string>()
    if (crowded || (tracks > 1 && step < gap)) {
        ({ trackOf, tracks } = packTracks(bundleUnits(users)))
        step = Math.max(Math.min(gap, (width - pad) / Math.max(tracks - 1, 1)), TRACK_GAP_MIN)
        need = frame + (tracks - 1) * step
        for (const unit of trackOf.keys())
            if (unit.key !== undefined && unit.users.length > 1)
                for (const u of unit.users)
                    bundled.set(u.edge, unit.key)
    }
    const offsets = new Map<number, number>()
    for (const [ unit, t ] of trackOf)
        for (const u of unit.users)
            offsets.set(u.edge, (t - (tracks - 1) / 2) * step)
    for (const u of users)
        if (!offsets.has(u.edge))
            offsets.set(u.edge, 0)
    return { offsets, need, bundled }
}

