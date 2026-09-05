/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  external dependencies  */
import UUID                                                 from "pure-uuid"

/*  internal dependencies  */
import { Node, Edge }                                       from "./gradia-api-model.js"
import { Config, ConfigEmbedded, resolveFont, cssValueOf }  from "./gradia-api-config.js"
import {
    Poly, NodeStyle,
    FS_NAME, FS_TYPE, FS_ATTR, FS_EDGE, FS_ARITY, FS_GROUP, ARITY_OFF,
    textWidth, escapeXML
} from "./gradia-api-render-base.js"
import { linesOfNode, urlOf, typeOf, defaultStyleOf, containerHead,
    MIN_H, NAME_H, ATTR_H, ATTR_P, TYPE_H, TYPE_D, HEAD_H }
    from "./gradia-api-render-node.js"
import { computeHops, pathOf, pointAt }
    from "./gradia-api-render-edge.js"

/*  escape a string for use inside a CSS string literal (the XML escaping
    is resolved by the parser before the CSS is parsed, so quotes and
    backslashes have to be neutralized to prevent a CSS injection, and
    the CSS newline characters LF, CR and FF have to be replaced, as
    they would end the string literal as an invalid "bad string")  */
const escapeCSS = (text: string): string =>
    text.replace(/[\\"']/g, "\\$&").replace(/[\r\n\f]/g, " ")

/*  the UUID namespace of Gradia, under which the per-document
    identifier prefixes are derived  */
const NS_GRADIA = new UUID(5, "ns:URL", "https://github.com/rse/gradia").format()

/*  derive a per-document identifier prefix from a seed, as the SVG
    identifiers are DOM-global and would collide once multiple diagrams
    are embedded into the very same document. The prefix is a UUID v5 of
    the seed and hence stays stable across regenerations of an unchanged
    diagram (the Base16 format keeps it alphanumeric and thus a valid XML
    name and CSS/URL fragment)  */
const idPrefix = (seed: string): string =>
    `gradia-${new UUID(5, NS_GRADIA, seed).format("b16").toLowerCase()}`

/*  a decorated group box surrounding the nodes of a named group  */
export interface GroupBox {
    name: string
    x:    number
    y:    number
    w:    number
    h:    number
}

/*  a decorated container box surrounding the members of a container node  */
export interface ContainerBox {
    node: Node
    x:    number
    y:    number
    w:    number
    h:    number
}

/*  the laid out graph handed over for SVG generation  */
export interface Layout {
    nodes:       Node[]
    edges:       Edge[]
    cx:          (id: string) => number
    cy:          (id: string) => number
    boxW:        Map<string, number>
    boxH:        Map<string, number>
    contentH:    Map<string, number>
    polys:       Poly[]
    styleOf?:    (node: Node) => NodeStyle
    groups?:     GroupBox[]
    containers?: ContainerBox[]
}

/*  a rectangular area, given by its top-left and bottom-right corners  */
type Box = [ number, number, number, number ]

/*  the placement of a group tag in the top-left corner of its group box  */
const TAG_DX = 18  /*  left offset of the group tag  */
const TAG_DY = 12  /*  top offset of the group tag   */

/*  the half width of the box an edge line segment occupies  */
const LINE_PAD = 2

/*  track occupied areas (node boxes and already placed labels) to
    let subsequent labels dodge into a collision-free position, and the
    edge lines (their segments and crossing hops) to let the labels at
    least prefer the position covering the fewest lines (the returned
    "occupied" array grows with every claimed label box and hence also
    serves as the box input of the overall bounding box)  */
const labelPlacer = (
    layout:    Layout,
    hops:      Map<number, number[]>[],
    hopRadius: number
): { claim: (candidates: Box[]) => Box, occupied: Box[] } => {
    const { nodes, cx, cy, boxW, boxH } = layout
    const occupied: Box[] = nodes.map((node) => [
        cx(node.id) - boxW.get(node.id)! / 2, cy(node.id) - boxH.get(node.id)! / 2,
        cx(node.id) + boxW.get(node.id)! / 2, cy(node.id) + boxH.get(node.id)! / 2
    ])

    /*  let the labels also dodge the group and container tags in the box corners  */
    for (const group of layout.groups ?? [])
        occupied.push([ group.x + TAG_DX, group.y + TAG_DY,
            group.x + TAG_DX + textWidth(group.name, FS_GROUP), group.y + TAG_DY + FS_GROUP * 1.2 ])
    for (const c of layout.containers ?? [])
        occupied.push([ c.x + TAG_DX, c.y + TAG_DY,
            c.x + TAG_DX + textWidth(c.node.name, FS_GROUP), c.y + containerHead(c.node) ])

    /*  collect the edge line segments and the hops bulging above them  */
    const lines: Box[] = []
    layout.polys.forEach((poly, i) => {
        for (let k = 0; k < poly.length - 1; k++) {
            const [ a, b ] = [ poly[k], poly[k + 1] ]
            lines.push([ Math.min(a[0], b[0]) - LINE_PAD, Math.min(a[1], b[1]) - LINE_PAD,
                Math.max(a[0], b[0]) + LINE_PAD, Math.max(a[1], b[1]) + LINE_PAD ])
            for (const hx of hops[i].get(k) ?? [])
                lines.push([ hx - hopRadius, a[1] - hopRadius, hx + hopRadius, a[1] ])
        }
    })

    /*  claim the candidate box colliding with the fewest occupied
        areas and, among those, with the fewest edge lines (earlier
        candidates win ties, so the first collision-free one is taken)  */
    const collisions = (boxes: Box[], box: Box): number =>
        boxes.filter((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]).length
    const claim = (candidates: Box[]): Box => {
        let box   = candidates[0]
        let worst = Infinity
        for (const c of candidates) {
            const score = collisions(occupied, c) * (lines.length + 1) + collisions(lines, c)
            if (score < worst) {
                box   = c
                worst = score
            }
            if (score === 0)
                break
        }
        occupied.push(box)
        return box
    }
    return { claim, occupied }
}

/*  generate the SVG fragments for a single node box (a node with a
    "url" attribute becomes a hyperlink covering the whole box)  */
const renderNode = (node: Node, layout: Layout, style: NodeStyle, font: string,
    color: (key: ConfigEmbedded) => string, config: Config): string[] => {
    const { cx, cy, boxW, boxH, contentH } = layout
    const w     = boxW.get(node.id)!
    const h     = boxH.get(node.id)!
    const x     = cx(node.id) - w / 2
    const y     = cy(node.id) - h / 2
    const lines = linesOfNode(node, config)
    const url   = urlOf(node)
    const parts: string[] = []
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ` +
        `style="fill: ${color(style.fill)}; stroke: ${color(style.stroke)}" stroke-width="4.0"` +
        `${style.dash !== undefined ? ` stroke-dasharray="${escapeXML(style.dash)}"` : ""}/>`)

    /*  vertically center the textual content block within the box, with
        the optional type lines shifting the name and attributes down and
        the additional wrapped name lines shifting the attributes down  */
    const ty    = cy(node.id) - contentH.get(node.id)! / 2
    const th    = lines.type.length * TYPE_H
    const nh    = (lines.name.length - 1) * NAME_H
    const nameY = lines.attrs.length > 0 ?
        ty + th + MIN_H / 2 + FS_NAME * 0.36 : cy(node.id) + th / 2 + FS_NAME * 0.36 - nh / 2
    lines.type.forEach((line, k) => {
        parts.push(`<text x="${cx(node.id)}" ` +
            `y="${nameY - TYPE_D - (lines.type.length - 1 - k) * TYPE_H}" text-anchor="middle" ` +
            `font-size="${FS_TYPE}" ` +
            `style="font-family: ${font}; fill: ${color(style.text)}">${escapeXML(line)}</text>`)
    })
    lines.name.forEach((line, k) => {
        parts.push(`<text x="${cx(node.id)}" y="${nameY + k * NAME_H}" text-anchor="middle" ` +
            `font-size="${FS_NAME}" font-weight="600" ` +
            `style="font-family: ${font}; fill: ${color(style.text)}">${escapeXML(line)}</text>`)
    })
    lines.attrs.forEach((line, k) => {
        parts.push(`<text x="${cx(node.id)}" ` +
            `y="${ty + th + nh + MIN_H + ATTR_P + k * ATTR_H}" text-anchor="middle" ` +
            `font-size="${FS_ATTR}" ` +
            `style="font-family: ${font}; fill: ${color(style.text)}">${escapeXML(line)}</text>`)
    })
    if (url === undefined)
        return parts
    return [ `<a href="${escapeXML(url)}" xlink:href="${escapeXML(url)}">`, ...parts, "</a>" ]
}

/*  determine the overall bounding box of all rendered elements (the
    node boxes and the placed labels are handed over as already
    computed areas, the edge polylines are scanned here)  */
const viewBoxOf = (layout: Layout, boxes: Box[], margin: number): { x: number, y: number, w: number, h: number } => {
    const { polys } = layout
    let [ minX, minY, maxX, maxY ] = [ Infinity, Infinity, -Infinity, -Infinity ]
    for (const [ bx1, by1, bx2, by2 ] of boxes) {
        minX = Math.min(minX, bx1)
        minY = Math.min(minY, by1)
        maxX = Math.max(maxX, bx2)
        maxY = Math.max(maxY, by2)
    }
    for (const poly of polys) {
        for (const [ px, py ] of poly) {
            minX = Math.min(minX, px)
            minY = Math.min(minY, py)
            maxX = Math.max(maxX, px)
            maxY = Math.max(maxY, py)
        }
    }
    if (!Number.isFinite(minX))
        [ minX, minY, maxX, maxY ] = [ 0, 0, 0, 0 ]
    return {
        x: Math.floor(minX - margin / 2),
        y: Math.floor(minY - margin / 2),
        w: Math.ceil(maxX - minX + margin),
        h: Math.ceil(maxY - minY + margin)
    }
}

/*  generate the SVG fragments for the labels of a single edge: its
    optional name, placed near the middle of the route, and its optional
    arity, placed near the arrow head (both dodging into a collision-free
    position through the "claim" of the label placer)  */
const renderEdgeLabels = (edge: Edge, poly: Poly, claim: (candidates: Box[]) => Box,
    font: string, color: (key: ConfigEmbedded) => string): string[] => {
    /*  the halo rendered behind the edge labels for readability
        (its color is emitted into the style attribute below, as only
        there the CSS custom property lookup can be resolved)  */
    const halo = "stroke-width=\"4.5\" paint-order=\"stroke\" stroke-linejoin=\"round\""
    const parts: string[] = []
    if (edge.name !== undefined) {
        const w = textWidth(edge.name, FS_EDGE)
        const candidates: Box[] = []
        for (const f of [ 0.50, 0.40, 0.60, 0.30, 0.70, 0.20, 0.80 ]) {
            const p = pointAt(poly, f)
            if (p.horizontal) {
                candidates.push([ p.x - w / 2, p.y - 23, p.x + w / 2, p.y - 3 ])
                candidates.push([ p.x - w / 2, p.y + 3,  p.x + w / 2, p.y + 23 ])
            }
            else {
                candidates.push([ p.x + 5,     p.y - 10, p.x + 5 + w, p.y + 10 ])
                candidates.push([ p.x - 5 - w, p.y - 10, p.x - 5,     p.y + 10 ])
            }
        }
        const box = claim(candidates)
        parts.push(`<text x="${(box[0] + box[2]) / 2}" y="${box[3] - 3}" text-anchor="middle" ` +
            `font-size="${FS_EDGE}" ` +
            `style="font-family: ${font}; fill: ${color("color-edge-name")}; ` +
            `stroke: ${color("color-edge-halo")}" ` +
            `${halo}>${escapeXML(edge.name)}</text>`)
    }
    if (edge.arity !== undefined) {
        const w    = textWidth(edge.arity, FS_ARITY)
        const p    = pointAt(poly, 1.0)
        const prev = pointAt(poly, 0.999)

        /*  set the arity back from the arrow head along the final
            segment and place it beside the line, so an edge approaching
            vertically keeps its arity next to its own arrow  */
        let candidates: Box[]
        if (p.horizontal) {
            const dx = Math.sign(p.x - prev.x) || 1
            const ax = p.x - dx * (ARITY_OFF + w / 2)
            candidates = [
                [ ax - w / 2,           p.y - 17, ax + w / 2,           p.y - 4  ],
                [ ax - w / 2,           p.y + 4,  ax + w / 2,           p.y + 17 ],
                [ ax - w / 2 - dx * 14, p.y - 17, ax + w / 2 - dx * 14, p.y - 4  ]
            ]
        }
        else {
            const dy = Math.sign(p.y - prev.y) || 1
            const ay = p.y - dy * ARITY_OFF
            candidates = [
                [ p.x + 6,     ay - 7,           p.x + 6 + w, ay + 6           ],
                [ p.x - 6 - w, ay - 7,           p.x - 6,     ay + 6           ],
                [ p.x + 6,     ay - 7 - dy * 14, p.x + 6 + w, ay + 6 - dy * 14 ]
            ]
        }
        const box = claim(candidates)
        parts.push(`<text x="${(box[0] + box[2]) / 2}" y="${box[3] - 3}" text-anchor="middle" ` +
            `font-size="${FS_ARITY}" ` +
            `style="font-family: ${font}; fill: ${color("color-edge-arity")}; ` +
            `stroke: ${color("color-edge-halo")}" ` +
            `${halo}>${escapeXML(edge.arity)}</text>`)
    }
    return parts
}

/*  render a laid out graph into an SVG document (the seed determines the
    identifier prefix of the document, see "idPrefix" above)  */
export const renderSVG = (layout: Layout, config: Config, explicit: Partial<Config>,
    seed: string): string => {
    const { nodes, edges, polys } = layout
    const groups     = layout.groups     ?? []
    const containers = layout.containers ?? []
    const styleOf    = layout.styleOf    ?? defaultStyleOf

    /*  resolve the directly embedded configuration options into CSS
        values: explicitly configured values are hard-coded, while all
        others are fetched at display time from the "--gradia-<option>"
        CSS custom properties, falling back to the built-in defaults  */
    const color = (key: ConfigEmbedded): string => escapeXML(cssValueOf(explicit, key))

    /*  derive the collision-free identifiers of this SVG document  */
    const prefix  = idPrefix(seed)
    const idArrow = `${prefix}-arrow`

    /*  resolve the configured font into the rendered font family stack  */
    const { family, embed, weight } = resolveFont(config)
    const stack = Object.hasOwn(explicit, "font-family") ?
        `'${escapeCSS(family)}'` :
        `var(--gradia-font-family, '${escapeCSS(family)}')`
    const font = escapeXML(`${stack}, ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif`)

    /*  detect the edge crossings requiring rendered hops  */
    const hops = computeHops(polys)

    /*  prepare the collision-free placement of the edge labels  */
    const { claim, occupied } = labelPlacer(layout, hops, config["size-edge-hop-radius"])

    /*  generate the SVG fragments for the edges (paths below, labels above)  */
    const svgEdges:  string[] = []
    const svgLabels: string[] = []
    edges.forEach((edge, i) => {
        svgEdges.push(`<path d="${pathOf(polys[i], hops[i],
            config["size-edge-corner-radius"], config["size-edge-hop-radius"])}" fill="none" ` +
            `style="stroke: ${color("color-edge-line")}" stroke-width="3.0" marker-end="url(#${idArrow})"/>`)
        svgLabels.push(...renderEdgeLabels(edge, polys[i], claim, font, color))
    })

    /*  generate the SVG fragments for the node boxes  */
    const svgNodes = nodes.flatMap((node) => renderNode(node, layout, styleOf(node), font, color, config))

    /*  generate the SVG fragments for the group boxes (drawn below
        everything else) and their tags in the top-left corners  */
    const svgGroups = groups.flatMap((group) => [
        `<rect x="${group.x}" y="${group.y}" width="${group.w}" height="${group.h}" rx="12" ` +
            `style="fill: ${color("color-group-box")}; ` +
            `stroke: ${color("color-group-border")}" stroke-width="3.0"/>`,
        `<text x="${group.x + TAG_DX}" y="${group.y + TAG_DY + FS_GROUP}" ` +
            `font-size="${FS_GROUP}" font-weight="600" ` +
            `style="font-family: ${font}; fill: ${color("color-group-name")}">${escapeXML(group.name)}</text>`
    ])

    /*  generate the SVG fragments for the container boxes (drawn below
        the edges and nodes, an outer box before its nested ones) and
        their tags in the top-left corners, with the optional type line
        above the name (a container with a "url" attribute becomes a
        hyperlink covering the whole box)  */
    const svgContainers = containers.flatMap((c) => {
        const type  = typeOf(c.node)
        const url   = urlOf(c.node)
        const parts = [
            `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="12" ` +
                `style="fill: ${color("color-container-box")}; ` +
                `stroke: ${color("color-container-border")}" stroke-width="3.0" stroke-dasharray="10 6"/>`,
            ...(type !== undefined ? [
                `<text x="${c.x + TAG_DX}" y="${c.y + TAG_DY + FS_TYPE}" ` +
                    `font-size="${FS_TYPE}" ` +
                    `style="font-family: ${font}; fill: ${color("color-container-name")}">${escapeXML(type)}</text>`
            ] : []),
            `<text x="${c.x + TAG_DX}" y="${c.y + containerHead(c.node) - HEAD_H + TAG_DY + FS_GROUP}" ` +
                `font-size="${FS_GROUP}" font-weight="600" ` +
                `style="font-family: ${font}; fill: ${color("color-container-name")}">${escapeXML(c.node.name)}</text>`
        ]
        if (url === undefined)
            return parts
        return [ `<a href="${escapeXML(url)}" xlink:href="${escapeXML(url)}">`, ...parts, "</a>" ]
    })

    /*  determine the overall bounding box of all rendered elements  */
    const groupBoxes: Box[] = groups.map((group) =>
        [ group.x, group.y, group.x + group.w, group.y + group.h ])
    const containerBoxes: Box[] = containers.map((c) =>
        [ c.x, c.y, c.x + c.w, c.y + c.h ])
    const vb = viewBoxOf(layout, [ ...occupied, ...groupBoxes, ...containerBoxes ], config["size-canvas-margin"])

    /*  assemble the final SVG document  */
    return [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" " +
            `viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${vb.w}" height="${vb.h}">`,
        "<defs>",
        ...(embed !== undefined ? [
            "<style>",
            `@font-face { font-family: "${escapeXML(escapeCSS(family))}"; ` +
                (weight !== undefined ? `font-weight: ${escapeXML(escapeCSS(weight))}; ` : "") +
                `src: url(data:font/woff2;base64,${embed}) format("woff2"); }`,
            "</style>"
        ] : []),
        `<marker id="${idArrow}" viewBox="0 0 10 10" refX="9" refY="5" ` +
            "markerWidth=\"21\" markerHeight=\"21\" markerUnits=\"userSpaceOnUse\" " +
            "orient=\"auto-start-reverse\">",
        `<path d="M 0 1 L 9 5 L 0 9 z" style="fill: ${color("color-edge-line")}"/>`,
        "</marker>",
        "</defs>",
        ...svgGroups,
        ...svgContainers,
        ...svgEdges,
        ...svgNodes,
        ...svgLabels,
        "</svg>",
        ""
    ].join("\n")
}

