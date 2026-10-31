/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Edge }                                             from "./gradia-api-model.js"
import { Config }                                           from "./gradia-api-config.js"
import { Poly, Layout, Box, Styler, FS_GROUP, TAG_DX, TAG_DY, ARITY_OFF, ARITY_PAD, ARITY_GAP, ARROW_AIR,
    REGION_HEAD, arityHeight, textWidth, escapeXML }
    from "./gradia-api-render-base.js"
import { containerHead }                                    from "./gradia-api-render-node.js"
import { pointAt, segmentsOf, transitionOf }                from "./gradia-api-render-edge.js"

/*  the half width of the box an edge line segment occupies  */
const LINE_PAD = 2

/*  the gap a name label on the stub of a bundled edge keeps in front of
    the shared track, clear of its junction dot and foreign lines  */
const STUB_GAP = 16

/*  the clearance a label keeps from a foreign edge line, as a label
    merely not overlapping such a line still reads as its annotation  */
const LINE_GAP = 12

/*  the gap between two arity labels set back one behind the other along
    one and the same edge line, and the number of such setbacks tried  */
const ARITY_STEP = 8
const ARITY_BACK = 3

/*  the step by which the anchor of a name label is set back along the
    stub arriving at the target, and the air it keeps beside it  */
const ANCHOR_STEP = 8
const ANCHOR_AIR  = 6

/*  the maximum number of steps a name label is slid along a single
    segment of its route, as a long segment would otherwise offer far
    more candidate positions than a placement can ever need  */
const SLIDE_MAX = 16

/*  a uniform grid of buckets indexing areas, so a query only visits
    the areas of the buckets it covers instead of all areas (an area
    spanning several buckets is visited once only, as every visit
    stamps it, and the bucket indices are clamped, so even far-off
    areas stay indexed, merely sharing the outermost buckets)  */
const BUCKET    = 64
const GRID_OFF  = 1 << 20
const GRID_SPAN = 2 * GRID_OFF
interface AreaGrid {
    add:    (area: Box) => number
    remove: (id: number) => void
    visit:  (x1: number, y1: number, x2: number, y2: number, fn: (id: number, area: Box) => boolean) => void
}
const areaGrid = (): AreaGrid => {
    const areas:   (Box | undefined)[] = []
    const buckets = new Map<number, number[]>()
    let   stamps  = new Uint32Array(0)
    let   stamp   = 0
    const bucketOf = (v: number): number =>
        Math.max(-GRID_OFF, Math.min(GRID_OFF - 1, Math.floor(v / BUCKET)))

    /*  index an area and return its identifier  */
    const add = (area: Box): number => {
        const id = areas.length
        areas.push(area)
        for (let by = bucketOf(area[1]); by <= bucketOf(area[3]); by++) {
            for (let bx = bucketOf(area[0]); bx <= bucketOf(area[2]); bx++) {
                const bucket = buckets.get(bx * GRID_SPAN + by)
                if (bucket === undefined)
                    buckets.set(bx * GRID_SPAN + by, [ id ])
                else
                    bucket.push(id)
            }
        }
        return id
    }

    /*  drop an indexed area  */
    const remove = (id: number): void => {
        areas[id] = undefined
    }

    /*  visit every indexed area sharing a bucket with the queried area
        once, until the visiting function signals to stop  */
    const visit = (x1: number, y1: number, x2: number, y2: number,
        fn: (id: number, area: Box) => boolean): void => {
        if (stamps.length < areas.length) {
            const grown = new Uint32Array(Math.max(areas.length, 2 * stamps.length))
            grown.set(stamps)
            stamps = grown
        }
        stamp++
        for (let by = bucketOf(y1); by <= bucketOf(y2); by++) {
            for (let bx = bucketOf(x1); bx <= bucketOf(x2); bx++) {
                const bucket = buckets.get(bx * GRID_SPAN + by)
                if (bucket === undefined)
                    continue
                for (const id of bucket) {
                    if (stamps[id] === stamp)
                        continue
                    stamps[id] = stamp
                    const area = areas[id]
                    if (area !== undefined && fn(id, area))
                        return
                }
            }
        }
    }
    return { add, remove, visit }
}

/*  track occupied areas (node boxes and already placed labels) to
    let subsequent labels dodge into a collision-free position, plus the
    areas merely reserved for the labels still to be placed, and the
    edge lines (their segments and crossing hops) to let the labels at
    least prefer the position covering the fewest lines (the returned
    "occupied" array grows with every claimed label box and hence also
    serves as the box input of the overall bounding box)  */
export const labelPlacer = (
    layout:    Layout,
    hops:      Map<number, number[]>[],
    hopRadius: number,
    config:    Config
): {
    claim:    (candidates: Box[], edge: number, dodge?: boolean, own?: Box, mates?: number[]) => Box,
    seize:    (box: Box, edge: number, cross?: number) => boolean,
    reserve:  (box: Box) => void,
    occupied: Box[]
} => {
    const { nodes, cx, cy, boxW, boxH } = layout
    const occupied: Box[] = nodes.map((node) => [
        cx(node.id) - boxW.get(node.id)! / 2,
        cy(node.id) - boxH.get(node.id)! / 2,
        cx(node.id) + boxW.get(node.id)! / 2, cy(node.id) + boxH.get(node.id)! / 2
    ])

    /*  let the labels also dodge the group and container tags in the box corners  */
    for (const group of layout.groups ?? [])
        occupied.push([ group.x + TAG_DX, group.y + TAG_DY,
            group.x + TAG_DX + textWidth(group.name, FS_GROUP), group.y + TAG_DY + FS_GROUP * 1.2 ])
    for (const c of layout.containers ?? [])
        occupied.push([ c.x + TAG_DX, c.y + TAG_DY,
            c.x + TAG_DX + textWidth(c.node.name, FS_GROUP),
            c.y + (c.style?.band !== undefined ? REGION_HEAD : containerHead(c.node, config, c.style !== undefined)) ])

    /*  let the labels also dodge the free-standing texts  */
    for (const shape of layout.shapes ?? [])
        if (shape.kind === "text")
            occupied.push(shape.box)

    /*  collect the edge line segments and the hops bulging above them,
        kept per edge, so a label can tell its own route from the foreign ones  */
    const lines: Box[][] = layout.polys.map((poly, i) => {
        const boxes: Box[] = []
        for (let k = 0; k < poly.length - 1; k++) {
            const [ a, b ] = [ poly[k], poly[k + 1] ]
            boxes.push([ Math.min(a[0], b[0]) - LINE_PAD, Math.min(a[1], b[1]) - LINE_PAD,
                Math.max(a[0], b[0]) + LINE_PAD, Math.max(a[1], b[1]) + LINE_PAD ])
            for (const hx of hops[i].get(k) ?? [])
                boxes.push([ hx - hopRadius, a[1] - hopRadius, hx + hopRadius, a[1] ])
        }
        return boxes
    })
    const lineCount = lines.reduce((n, boxes) => n + boxes.length, 0)

    /*  index the edge line boxes, the occupied areas, and the
        reserved areas, as the placement of every label queries them
        for all of its candidate boxes  */
    const lineGrid = areaGrid()
    const owner: number[] = []
    lines.forEach((boxes, i) => {
        for (const o of boxes)
            owner[lineGrid.add(o)] = i
    })
    const occupiedGrid = areaGrid()
    for (const o of occupied)
        occupiedGrid.add(o)
    const reservedGrid = areaGrid()

    /*  claim the candidate box colliding with the fewest occupied
        areas and, among those, with the fewest edge lines (earlier
        candidates win ties, so the first collision-free one is taken),
        where the own edge lines count on touch only, as the label sits
        beside its own route by construction, while the foreign ones
        count already within a clearance, so a label hugging a foreign
        line loses against one staying with its own edge. A claim with
        "dodge" unset weighs the lines not at all, as its candidates are
        ordered by a proximity which matters more than a crossed line,
        which the halo of the label keeps readable anyway (the lines of
        the "mates" of the edge, labeled together with it, count as own)  */
    const hit = (o: Box, x1: number, y1: number, x2: number, y2: number): boolean =>
        x1 < o[2] && x2 > o[0] && y1 < o[3] && y2 > o[1]
    const collisions = (grid: AreaGrid, box: Box): number => {
        let n = 0
        grid.visit(box[0], box[1], box[2], box[3], (_, o) => {
            if (hit(o, box[0], box[1], box[2], box[3]))
                n++
            return false
        })
        return n
    }

    /*  count the edge line boxes a candidate box crosses, but stop
        counting once the given limit is reached, as the candidate then
        cannot win anymore (the own lines are tested against the box
        itself, the foreign ones against the box grown by the clearance,
        which hence also bounds the buckets to visit)  */
    const crossings = (box: Box, edge: number, limit: number, mates?: number[], gap = LINE_GAP): number => {
        const [ x1, y1, x2, y2 ] = [ box[0] - gap, box[1] - gap, box[2] + gap, box[3] + gap ]
        let n = 0
        lineGrid.visit(x1, y1, x2, y2, (id, o) => {
            if (owner[id] === edge || mates?.includes(owner[id]) === true ?
                hit(o, box[0], box[1], box[2], box[3]) : hit(o, x1, y1, x2, y2))
                n++
            return n >= limit
        })
        return n
    }

    /*  reserve an area, indexed under its very object, so the claim of
        the label it is reserved for can release it again  */
    const reserved = new Map<Box, number[]>()
    const reserve = (box: Box) => {
        const id  = reservedGrid.add(box)
        const ids = reserved.get(box)
        if (ids === undefined)
            reserved.set(box, [ id ])
        else
            ids.push(id)
    }

    /*  a claim counts the areas reserved for the labels still to come
        like the occupied ones, so an early label yields the position a
        later one depends upon wherever it has an alternative of its
        own, while the "own" reservation of the claiming label is
        released, as that is the very area it is about to take  */
    const claim = (candidates: Box[], edge: number, dodge = true, own?: Box, mates?: number[]): Box => {
        if (own !== undefined) {
            const id = reserved.get(own)?.shift()
            if (id !== undefined)
                reservedGrid.remove(id)
        }
        let box    = candidates[0]
        let lowest = Infinity
        for (const c of candidates) {
            /*  a candidate whose collisions alone already reach the lowest
                score is skipped, as its line crossings, of which there are
                at most "lineCount", can never let it win anymore  */
            let score = (collisions(occupiedGrid, c) + collisions(reservedGrid, c)) * (lineCount + 1)
            if (score >= lowest)
                continue
            if (dodge)
                score += crossings(c, edge, lowest - score, mates)
            if (score < lowest) {
                box    = c
                lowest = score
            }
            if (score === 0)
                break
        }
        occupied.push(box)
        occupiedGrid.add(box)
        return box
    }

    /*  claim a single box only if it is free: colliding with no occupied
        or reserved area (with some air beside it) and crossed by at most
        the given number of other lines (beneath its halo), as its fixed
        position attributes it to its edge  */
    const seize = (box: Box, edge: number, cross = 0): boolean => {
        const aired: Box = [ box[0] - ANCHOR_AIR, box[1], box[2] + ANCHOR_AIR, box[3] ]
        if (collisions(occupiedGrid, aired) > 0 || collisions(reservedGrid, aired) > 0
            || crossings(box, edge, cross + 1, undefined, 0) > cross)
            return false
        occupied.push(box)
        occupiedGrid.add(box)
        return true
    }
    return { claim, seize, reserve, occupied }
}

/*  the candidate positions of the arity label of an edge: set back
    from the arrow head along the final segment and placed beside the
    line, so an edge approaching vertically keeps its arity next to its
    own arrow, offering both sides at every further setback, which steps
    by the label extent along the segment, as a shorter step would leave
    the label on top of the very label it dodges  */
export const arityBoxes = (arity: string, poly: Poly, config: Config): Box[] => {
    const w    = textWidth(arity, config["size-font-arity"])
    const h    = arityHeight(config)
    const p    = pointAt(poly, 1.0)
    const prev = pointAt(poly, 0.999)
    const candidates: Box[] = []
    for (let k = 0; k < ARITY_BACK; k++) {
        const back = k * ((p.horizontal ? w : h) + ARITY_STEP)
        if (p.horizontal) {
            const dx = Math.sign(p.x - prev.x) || 1
            const ax = p.x - dx * (ARITY_OFF + w / 2 + back)
            candidates.push([ ax - w / 2, p.y - ARITY_PAD - h, ax + w / 2, p.y - ARITY_PAD     ])
            candidates.push([ ax - w / 2, p.y + ARITY_PAD,     ax + w / 2, p.y + ARITY_PAD + h ])
        }
        else {
            const dy = Math.sign(p.y - prev.y) || 1
            const ay = p.y - dy * (ARITY_OFF + back)
            candidates.push([ p.x + 6,     ay + 6 - h, p.x + 6 + w, ay + 6 ])
            candidates.push([ p.x - 6 - w, ay + 6 - h, p.x - 6,     ay + 6 ])
        }
    }
    return candidates
}

/*  generate the SVG fragment for the arity label of a single edge,
    which claims one of its candidate positions without dodging the
    edge lines, as the neighboring ports of a node run closer than any
    clearance anyway and it is the very setback from its own arrow head
    which attaches it to its edge, so a line crossed beneath its halo
    weighs less than a drift away from that arrow  */
export const renderEdgeArity = (edge: Edge, candidates: Box[], claim: (candidates: Box[], dodge?: boolean,
    own?: Box) => Box, styler: Styler, alert: boolean): string[] => {
    if (edge.arity === undefined)
        return []
    const box = claim(candidates, false, candidates[0])
    return [ `<text x="${(box[0] + box[2]) / 2}" y="${box[3] - 3}" ` +
        `class="${styler.text(alert ? "color-mark-violation" : "color-edge-arity", "size-font-arity",
            { middle: true, halo: true })}">${escapeXML(edge.arity)}</text>` ]
}

/*  the preferred positions of the name labels of the bundled edges: on
    the stub feeding the shared track (or else leaving it), flush toward
    the track, above (or else below) the line, so the labels of a bundle
    line up in front of the track instead of scattering along the stubs  */
export const stubLabels = (layout: Layout, config: Config): Map<number, Box[]> => {
    const { edges, polys } = layout
    const anchors = new Map<number, Box[]>()
    const bundled = (i: number): boolean => layout.bundled?.[i] === true
    if (!edges.some((edge, i) => bundled(i) && edge.name !== undefined))
        return anchors

    /*  a vertical segment lies on a shared track if another bundled edge
        runs on its X position, and a horizontal stub is an own one if
        no other bundled edge overlaps it  */
    const { verts, horzs } = segmentsOf(polys, bundled)
    const shared = (i: number, a: [ number, number ], b: [ number, number ]): boolean =>
        a[0] === b[0] && (verts.get(a[0]) ?? []).some((seg) => seg.owner !== i)
    const own = (i: number, a: [ number, number ], b: [ number, number ]): boolean =>
        !(horzs.get(a[1]) ?? []).some((seg) => seg.owner !== i
            && Math.min(seg.hi, Math.max(a[0], b[0])) > Math.max(seg.lo, Math.min(a[0], b[0])))

    /*  place the label of every bundled edge on its first horizontal
        stub turning onto (or else coming from) a shared track, as far
        as the stub is long enough to hold it  */
    edges.forEach((edge, i) => {
        if (!bundled(i) || edge.name === undefined)
            return
        const poly = polys[i]
        const w    = textWidth(edge.name, config["size-font-edge"])
        const h    = config["size-font-edge"] + 4
        for (const feeding of [ true, false ]) {
            for (let k = 0; k < poly.length - 1; k++) {
                const [ a, b ] = [ poly[k], poly[k + 1] ]
                if (a[1] !== b[1] || !own(i, a, b) || !(feeding ?
                    k + 2 < poly.length && shared(i, b, poly[k + 2]) :
                    k >= 1 && shared(i, poly[k - 1], a)))
                    continue
                const [ from, at ] = feeding ? [ a, b ] : [ b, a ]
                if (Math.abs(at[0] - from[0]) < w + 2 * STUB_GAP)
                    continue
                const dir = Math.sign(at[0] - from[0])
                const x2  = at[0] - dir * STUB_GAP
                const x1  = x2 - dir * w
                anchors.set(i, [
                    [ Math.min(x1, x2), a[1] - 3 - h, Math.max(x1, x2), a[1] - 3     ],
                    [ Math.min(x1, x2), a[1] + 3,     Math.max(x1, x2), a[1] + 3 + h ]
                ])
                return
            }
        }
    })
    return anchors
}

/*  the anchors of the name label of an edge: on the last horizontal
    segment of its route, above the line on the baseline of the arity,
    flush in front of the arity (or its setback from the arrow head) or,
    for a segment ending in a corner, in front of that corner, and, where
    that spot is taken, stepping back along the segment as far as the
    label stays clear of its other corner (if that corner bends towards
    the label), then the same below the line (in front of the arrow head,
    as the arity sits above the line), and finally the same on the
    horizontal segment before, for a last one too short for the label
    (only up to the given number of horizontal segments)  */
export const arrivalLabels = (edge: Edge, poly: Poly, config: Config, segments = 2): Box[] => {
    if (edge.name === undefined)
        return []
    const w      = textWidth(edge.name, config["size-font-edge"])
    const h      = config["size-font-edge"] + 4
    const radius = config["size-edge-corner-radius"]
    const anchors: Box[] = []
    let seen = 0
    for (let k = poly.length - 2; k >= 0 && seen < segments; k--) {
        if (poly[k][1] !== poly[k + 1][1])
            continue
        seen++
        const [ a, b ] = [ poly[k], poly[k + 1] ]
        const last  = k === poly.length - 2
        const gap   = last ? ARITY_OFF +
            (edge.arity !== undefined ? textWidth(edge.arity, config["size-font-arity"]) + ARITY_GAP : 0) :
            radius + ARROW_AIR
        const dir   = Math.sign(b[0] - a[0])
        const from  = k > 0 ? Math.sign(poly[k - 1][1] - a[1]) : 0
        const spots = (off: number, below: boolean) => {
            const room = Math.abs(b[0] - a[0]) - off - w - (from === (below ? 1 : -1) ? radius : 0)
            for (let back = 0; back <= room; back += ANCHOR_STEP) {
                const x2 = b[0] - dir * (off + back)
                const x1 = x2 - dir * w
                anchors.push(below ?
                    [ Math.min(x1, x2), b[1] + ARITY_PAD, Math.max(x1, x2), b[1] + ARITY_PAD + h ] :
                    [ Math.min(x1, x2), b[1] - ARITY_PAD - h, Math.max(x1, x2), b[1] - ARITY_PAD ])
            }
        }
        spots(gap, false)
        spots(last ? ARITY_OFF : gap, true)
    }
    return anchors
}

/*  the preferred positions of the one name label of a group of bundled
    edges merged into one port, on the stub between their track and that
    port, above the line: at the anchor of a single edge (see
    "arrivalLabels") at the port they run into, and flush with the box
    (or else below the line) at the one they leave  */
export const portLabels = (edge: Edge, poly: Poly, into: boolean, config: Config): Box[] => {
    if (edge.name === undefined)
        return []
    if (into)
        return poly[poly.length - 2][1] === poly[poly.length - 1][1] ? arrivalLabels(edge, poly, config, 1).slice(0, 1) : []
    const w = textWidth(edge.name, config["size-font-edge"])
    const h = config["size-font-edge"] + 4
    const [ a, b ] = [ poly[1], poly[0] ]
    if (a[1] !== b[1])
        return []
    const dir   = Math.sign(b[0] - a[0])
    const span  = (x2: number): [ number, number ] =>
        [ Math.min(x2, x2 - dir * w), Math.max(x2, x2 - dir * w) ]
    const below = (x2: number): Box => [ span(x2)[0], b[1] + 3, span(x2)[1], b[1] + 3 + h ]
    const above = (x2: number): Box => [ span(x2)[0], b[1] - 3 - h, span(x2)[1], b[1] - 3 ]
    return [ above(b[0] - dir * STUB_GAP), below(b[0] - dir * STUB_GAP) ]
}

/*  generate the SVG fragment for the name label of a single edge,
    placed near the middle of the route (dodging into a collision-free
    position through the "claim" of the label placer), or, for a
    bundled edge, preferably at one of its given stub positions  */
export const renderEdgeName = (edge: Edge, poly: Poly, claim: (candidates: Box[], dodge?: boolean) => Box,
    styler: Styler, config: Config, alert: boolean, preferred: Box[] = [], styled = false): string[] => {
    if (edge.name === undefined)
        return []
    const w = textWidth(edge.name, config["size-font-edge"])
    const h = config["size-font-edge"] + 4

    /*  offer, along every segment of the own route and on both sides
        of its line, the label centered on the segment plus the two
        positions flush with its ends plus, where the segment takes the
        label at all, the positions sliding between those ends in steps
        of half the label extent, as the free space along a route is
        regularly not where the segment centers are, and order the
        candidates by the distance from the middle of the route, so the
        label ends up as close to that middle as the collisions along
        the way allow  */
    const slide = (lo: number, hi: number, extent: number): number[] => {
        const first     = lo + extent / 2
        const last      = hi - extent / 2
        const positions = [ (lo + hi) / 2, first, last ]
        if (last > first) {
            const steps = Math.min(Math.ceil((last - first) / (extent / 2)), SLIDE_MAX)
            for (let k = 1; k < steps; k++)
                positions.push(first + (last - first) * k / steps)
        }
        return positions
    }
    const mid = pointAt(poly, 0.50)
    const near = (box: Box): number =>
        Math.abs((box[0] + box[2]) / 2 - mid.x) + Math.abs((box[1] + box[3]) / 2 - mid.y)
    const candidates: Box[] = []
    for (let k = 0; k < poly.length - 1; k++) {
        const [ a, b ] = [ poly[k], poly[k + 1] ]
        if (a[1] === b[1]) {
            for (const x of slide(Math.min(a[0], b[0]), Math.max(a[0], b[0]), w)) {
                candidates.push([ x - w / 2, a[1] - 3 - h, x + w / 2, a[1] - 3     ])
                candidates.push([ x - w / 2, a[1] + 3,     x + w / 2, a[1] + 3 + h ])
            }
        }
        else {
            for (const y of slide(Math.min(a[1], b[1]), Math.max(a[1], b[1]), h)) {
                candidates.push([ a[0] + 5,     y - h / 2, a[0] + 5 + w, y + h / 2 ])
                candidates.push([ a[0] - 5 - w, y - h / 2, a[0] - 5,     y + h / 2 ])
            }
        }
    }
    candidates.sort((a, b) => near(a) - near(b))
    candidates.unshift(...preferred)
    return nameText(edge, claim(candidates), styler, alert, "middle", styled)
}

/*  the SVG text content of an edge name: for a transition label of the
    form "event [guard] / action", its guard in italics and its action
    dimmed, so the parts of a longer label are easy to tell apart  */
const nameContent = (name: string, styled: boolean): string => {
    const { event, guard, action } = transitionOf(name)
    if (!styled || (guard === undefined && action === undefined))
        return escapeXML(name)
    const parts: string[] = event !== "" ? [ escapeXML(event) ] : []
    if (guard !== undefined)
        parts.push(`<tspan font-style="italic">[${escapeXML(guard)}]</tspan>`)
    if (action !== undefined)
        parts.push(`<tspan fill-opacity="0.65">/ ${escapeXML(action)}</tspan>`)
    return parts.join(" ")
}

/*  generate the SVG fragment for the name label of an edge at its claimed
    position, centered on it, or else aligned to its start or end (as the
    estimated text width may deviate, and an anchored label stays flush)  */
export const nameText = (edge: Edge, box: Box, styler: Styler, alert: boolean,
    align: "middle" | "start" | "end" = "middle", styled = false): string[] =>
    [ `<text x="${align === "middle" ? (box[0] + box[2]) / 2 : align === "start" ? box[0] : box[2]}" ` +
        `y="${box[3] - 3}" class="${styler.text(alert ? "color-mark-violation" : "color-edge-name",
            "size-font-edge", { middle: align === "middle", end: align === "end", halo: true })}">` +
        `${nameContent(edge.name ?? "", styled)}</text>` ]

