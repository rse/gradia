/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Poly }             from "./gradia-api-render-base.js"

/*  drop duplicate and collinear intermediate points of a polyline  */
export const simplifyPoly = (pts: Poly): Poly => {
    /*  drop the collinear intermediate points first, as collapsing
        a backtracking triple leaves a duplicate point pair behind  */
    const flat: Poly = [ ...pts ]
    for (let k = flat.length - 2; k > 0; k--) {
        const [ a, b, c ] = [ flat[k - 1], flat[k], flat[k + 1] ]
        if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]))
            flat.splice(k, 1)
    }

    /*  drop the remaining duplicate points  */
    const out: Poly = []
    for (const p of flat) {
        const q = out.at(-1)
        if (q !== undefined && q[0] === p[0] && q[1] === p[1])
            continue
        out.push(p)
    }
    return out
}

/*  detect edge crossings: for every horizontal segment determine the
    vertical segments of all other edges crossing it (hops are always
    drawn on the horizontal segment of the crossing pair)  */
export const computeHops = (polys: Poly[]): Map<number, number[]>[] => {
    /*  collect all vertical segments once, instead of re-scanning
        every polyline again for each single horizontal segment  */
    const verts: { idx: number, owner: number, x: number, y1: number, y2: number }[] = []
    polys.forEach((poly, j) => {
        for (let m = 0; m < poly.length - 1; m++) {
            const [ c, d ] = [ poly[m], poly[m + 1] ]
            if (c[0] !== d[0])
                continue
            verts.push({ idx: verts.length, owner: j, x: c[0], y1: Math.min(c[1], d[1]), y2: Math.max(c[1], d[1]) })
        }
    })

    /*  sweep the vertical segments ordered by their position, so every
        horizontal segment only visits the ones within its own span (found
        by a binary search), and report the crossing ones in their original
        order of collection  */
    const byX = verts.slice().sort((a, b) => a.x - b.x)
    return polys.map((poly, i) => {
        const result = new Map<number, number[]>()
        for (let k = 0; k < poly.length - 1; k++) {
            const [ a, b ] = [ poly[k], poly[k + 1] ]
            if (a[1] !== b[1])
                continue
            const hy  = a[1]
            const lo  = Math.min(a[0], b[0]) + 1
            const hi  = Math.max(a[0], b[0]) - 1
            let   l   = 0
            let   h   = byX.length
            while (l < h) {
                const m = (l + h) >>> 1
                if (byX[m].x > lo)
                    h = m
                else
                    l = m + 1
            }
            const found: typeof verts = []
            for (let m = l; m < byX.length && byX[m].x < hi; m++) {
                const v = byX[m]
                if (v.owner !== i && hy > v.y1 + 1 && hy < v.y2 - 1)
                    found.push(v)
            }
            if (found.length > 0)
                result.set(k, found.sort((a, b) => a.idx - b.idx).map((v) => v.x))
        }
        return result
    })
}

/*  a straight polyline segment of an edge (its owner): its span along
    the vertical/horizontal line at its X/Y position  */
export interface Segment {
    lo:    number
    hi:    number
    owner: number
}

/*  index the segments of the selected polylines: the vertical ones by
    their X and the horizontal ones by their Y position  */
export const segmentsOf = (polys: Poly[], selected: (i: number) => boolean) => {
    const verts = new Map<number, Segment[]>()
    const horzs = new Map<number, Segment[]>()
    polys.forEach((poly, i) => {
        if (!selected(i))
            return
        for (let k = 0; k < poly.length - 1; k++) {
            const [ a, b ] = [ poly[k], poly[k + 1] ]
            const [ map, at, p, q ] = a[0] === b[0] ?
                [ verts, a[0], a[1], b[1] ] : [ horzs, a[1], a[0], b[0] ]
            const seg  = { lo: Math.min(p, q), hi: Math.max(p, q), owner: i }
            const list = map.get(at)
            if (list === undefined)
                map.set(at, [ seg ])
            else
                list.push(seg)
        }
    })
    return { verts, horzs }
}

/*  the junctions of the selected polylines (of the bundled edges): the
    bends where lines of at least three directions (up, down, left,
    right) meet, as a stub joins or a shared track forks there (unlike
    at a common corner, where all of them turn alike)  */
export const junctionsOf = (polys: Poly[], selected: (i: number) => boolean): Poly => {
    const { verts, horzs } = segmentsOf(polys, selected)
    const seen = new Set<string>()
    const out: Poly = []
    for (const [ i, poly ] of polys.entries()) {
        if (!selected(i))
            continue
        for (let k = 1; k < poly.length - 1; k++) {
            const [ x, y ] = poly[k]
            const key = `${x}:${y}`
            if (seen.has(key))
                continue
            seen.add(key)
            let dirs = 0
            for (const { lo, hi } of verts.get(x) ?? [])
                dirs |= (lo < y && y <= hi ? 1 : 0) | (lo <= y && y < hi ? 2 : 0)
            for (const { lo, hi } of horzs.get(y) ?? [])
                dirs |= (lo < x && x <= hi ? 4 : 0) | (lo <= x && x < hi ? 8 : 0)
            if ((dirs & 1) + ((dirs >> 1) & 1) + ((dirs >> 2) & 1) + ((dirs >> 3) & 1) >= 3)
                out.push([ x, y ])
        }
    }
    return out
}

/*  a piece of an edge polyline to draw: a sub-polyline, the index of
    the segment of the whole polyline it starts on, and whether it runs
    up to the end of the whole polyline (and hence carries its arrow head)  */
export interface Piece {
    poly: Poly
    from: number
    end:  boolean
}

/*  split the polylines of the bundled edges into the pieces not yet
    covered by an earlier bundled edge, so their shared segments are
    drawn once (coinciding anti-aliased lines add up into a thicker one):
    the first edge of a bundle keeps its whole route, every further one
    only its stub up to (or from) its junction with the shared track  */
export const piecesOf = (polys: Poly[], bundled?: boolean[]): Piece[][] => {
    /*  the covered intervals of the vertical lines by their X and of
        the horizontal lines by their Y position, kept sorted  */
    const verts = new Map<number, [ number, number ][]>()
    const horzs = new Map<number, [ number, number ][]>()
    const cover = (map: Map<number, [ number, number ][]>, at: number, a: number, b: number) =>
        map.set(at, [ ...(map.get(at) ?? []), [ Math.min(a, b), Math.max(a, b) ] as [ number, number ] ]
            .sort((m, n) => m[0] - n[0]))

    /*  the uncovered intervals of a line between two positions, in the
        order from the first to the second position  */
    const uncovered = (covered: [ number, number ][] | undefined, a: number, b: number): [ number, number ][] => {
        const out: [ number, number ][] = []
        let pos = Math.min(a, b)
        for (const [ lo, hi ] of covered ?? []) {
            if (hi <= pos || lo >= Math.max(a, b))
                continue
            if (lo > pos)
                out.push([ pos, lo ])
            pos = Math.max(pos, hi)
        }
        if (pos < Math.max(a, b))
            out.push([ pos, Math.max(a, b) ])
        return a <= b ? out : out.reverse().map(([ lo, hi ]) => [ hi, lo ])
    }

    return polys.map((poly, i) => {
        if (bundled?.[i] !== true)
            return [ { poly, from: 0, end: true } ]

        /*  collect the uncovered parts of the segments, continuing the
            current piece as long as they adjoin  */
        const pieces: Piece[] = []
        let current: Piece | undefined
        for (let k = 0; k < poly.length - 1; k++) {
            const [ a, b ] = [ poly[k], poly[k + 1] ]
            const vertical = a[0] === b[0]
            const point = (v: number): [ number, number ] => vertical ? [ a[0], v ] : [ v, a[1] ]
            const parts = vertical ?
                uncovered(verts.get(a[0]), a[1], b[1]) :
                uncovered(horzs.get(a[1]), a[0], b[0])
            for (const [ s, t ] of parts) {
                const last = current?.poly.at(-1)
                if (current !== undefined && last !== undefined && last[0] === point(s)[0] && last[1] === point(s)[1])
                    current.poly.push(point(t))
                else {
                    if (current !== undefined)
                        pieces.push(current)
                    current = { poly: [ point(s), point(t) ], from: k, end: false }
                }
            }
            if (current !== undefined && (parts.length === 0 || parts.at(-1)![1] !== (vertical ? b[1] : b[0]))) {
                pieces.push(current)
                current = undefined
            }
        }
        if (current !== undefined)
            pieces.push({ ...current, end: true })

        /*  let the polyline of this edge cover the ones of the later edges  */
        for (let k = 0; k < poly.length - 1; k++) {
            const [ a, b ] = [ poly[k], poly[k + 1] ]
            if (a[0] === b[0])
                cover(verts, a[0], a[1], b[1])
            else
                cover(horzs, a[1], a[0], b[0])
        }
        return pieces
    })
}

/*  the Manhattan length of an orthogonal polyline segment  */
const len = (a: [ number, number ], b: [ number, number ]): number =>
    Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])

/*  convert an edge polyline into an SVG path with rounded corners
    at the bends (except the bends at a junction of bundled edges,
    where the edge turns sharply at the junction mark) and
    semi-circular hops at the crossing points (with "bridges", as for a
    crowded diagram whose closely spaced tracks would make the hops wavy,
    a merged run is spanned by one flat bridge), optionally only for a
    piece of it (see "piecesOf")  */
export const pathOf = (poly: Poly, hop: Map<number, number[]>, rounding: number, hopRadius: number,
    junction?: (x: number, y: number) => boolean, bridges = false, piece?: Piece): string => {
    const radius = (k: number): number => {
        if (k <= 0 || k >= poly.length - 1 || junction?.(poly[k][0], poly[k][1]))
            return 0
        let r = Math.min(rounding, len(poly[k - 1], poly[k]) / 2, len(poly[k], poly[k + 1]) / 2)

        /*  shrink the corner rounding when a crossing hop sits close
            to the bend, so the hop is never swallowed by the arc  */
        for (const seg of [ k - 1, k ])
            for (const hx of hop.get(seg) ?? [])
                r = Math.min(r, Math.max(Math.abs(hx - poly[k][0]) - hopRadius - 2, 4))
        return r
    }

    /*  the rounding of the corners of the drawn points (the ends of a
        piece stay sharp, its corners rounded at most along its parts)  */
    const pts    = piece?.poly ?? poly
    const from   = piece?.from ?? 0
    const corner = (j: number): number =>
        j <= 0 || j >= pts.length - 1 ? 0 :
            Math.min(radius(from + j), len(pts[j - 1], pts[j]), len(pts[j], pts[j + 1]))
    const d: string[] = []
    for (let j = 0; j < pts.length - 1; j++) {
        const k   = from + j
        const [ a, b ] = [ pts[j], pts[j + 1] ]
        const l   = len(a, b)
        const ux  = (b[0] - a[0]) / l
        const uy  = (b[1] - a[1]) / l
        const r0  = corner(j)
        const r1  = corner(j + 1)
        const p0: [ number, number ] = [ a[0] + ux * r0, a[1] + uy * r0 ]
        const p1: [ number, number ] = [ b[0] - ux * r1, b[1] - uy * r1 ]
        if (j === 0)
            d.push(`M ${p0[0]} ${p0[1]}`)
        if (a[1] === b[1] && hop.has(k)) {
            const dir = Math.sign(b[0] - a[0])
            const xs  = hop.get(k)!
                .filter((hx) => (hx - p0[0]) * dir > 2 && (p1[0] - hx) * dir > 2)
                .sort((m, n) => (m - n) * dir)

            /*  merge closely adjacent crossings into groups, each
                rendered as one single wide "long hop" arc (crossings
                are merged whenever the flat line piece left between
                their individual hops would be shorter than 14px), or,
                with bridges, as one flat bridge (merged whenever that
                piece would be shorter than two hops)  */
            const merge  = bridges ? hopRadius * 6 : hopRadius * 2 + 14
            const groups: number[][] = []
            for (const hx of xs) {
                const g = groups.at(-1)
                if (g !== undefined && Math.abs(hx - g.at(-1)!) <= merge)
                    g.push(hx)
                else
                    groups.push([ hx ])
            }
            for (const g of groups) {
                let x1 = g[0] - dir * hopRadius
                let x2 = g.at(-1)! + dir * hopRadius

                /*  clamp the arc into the drawable segment part, so
                    crossings close to a corner still get their hop  */
                if ((x1 - p0[0]) * dir < 0)
                    x1 = p0[0]
                if ((p1[0] - x2) * dir < 0)
                    x2 = p1[0]
                d.push(`L ${x1} ${a[1]}`)
                const sweep = dir > 0 ? 1 : 0
                const rise  = Math.min(hopRadius, Math.abs(x2 - x1) / 2)
                if (bridges && g.length > 1) {
                    d.push(`A ${rise} ${hopRadius} 0 0 ${sweep} ${x1 + dir * rise} ${a[1] - hopRadius}`)
                    d.push(`L ${x2 - dir * rise} ${a[1] - hopRadius}`)
                    d.push(`A ${rise} ${hopRadius} 0 0 ${sweep} ${x2} ${a[1]}`)
                }
                else
                    d.push(`A ${Math.abs(x2 - x1) / 2} ${hopRadius} 0 0 ${sweep} ${x2} ${a[1]}`)
            }
        }
        d.push(`L ${p1[0]} ${p1[1]}`)
        if (j < pts.length - 2) {
            const c  = pts[j + 1]
            const n  = pts[j + 2]
            const nl = len(c, n)
            const q: [ number, number ] = [
                c[0] + (n[0] - c[0]) / nl * r1,
                c[1] + (n[1] - c[1]) / nl * r1
            ]
            d.push(`Q ${b[0]} ${b[1]} ${q[0]} ${q[1]}`)
        }
    }
    return d.join(" ")
}

/*  determine a point on a polyline at a given fraction of its length  */
export const pointAt = (poly: Poly, fraction: number): { x: number, y: number, horizontal: boolean } => {
    const lens  = poly.slice(0, -1).map((p, k) => len(p, poly[k + 1]))
    const total = lens.reduce((a, b) => a + b, 0)
    let want    = total * fraction
    for (let k = 0; k < lens.length; k++) {
        if (want <= lens[k] || k === lens.length - 1) {
            const t = lens[k] > 0 ? want / lens[k] : 0
            return {
                x: poly[k][0] + (poly[k + 1][0] - poly[k][0]) * Math.min(t, 1),
                y: poly[k][1] + (poly[k + 1][1] - poly[k][1]) * Math.min(t, 1),
                horizontal: poly[k][1] === poly[k + 1][1]
            }
        }
        want -= lens[k]
    }
    return { x: poly[0][0], y: poly[0][1], horizontal: true }
}

