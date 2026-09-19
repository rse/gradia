/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  external dependencies  */
import UUID                                                 from "pure-uuid"

/*  internal dependencies  */
import { Node, Edge }                                       from "./gradia-api-model.js"
import { Config, ConfigEmbedded, ConfigFontSize, resolveFont, cssValueOf, cssSizeOf }
    from "./gradia-api-config.js"
import { Poly, NodeStyle, Layout, GroupBox, ContainerBox,
    FS_GROUP, ARITY_OFF, ARITY_PAD, arityHeight, textWidth, escapeXML }
    from "./gradia-api-render-base.js"
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
    are embedded into the very same document. The prefix is derived from
    the UUID v5 of the seed and hence stays stable across regenerations
    of an unchanged diagram (the Base16 format keeps it alphanumeric and
    thus a valid XML name and CSS/URL fragment, and its leading 12 digits
    keep the identifiers short, as every edge references one, while
    still making a collision among the diagrams of a document unlikely)  */
const idPrefix = (seed: string): string =>
    `gradia-${new UUID(5, NS_GRADIA, seed).format("b16").toLowerCase().slice(0, 12)}`

/*  the styling of the rendered elements: instead of repeating the very
    same lengthy style on every element, the elements reference CSS
    classes, which the document declares once. A class is named after
    the UUID v5 of its own declarations, so equal declarations share
    one class, even across the diagrams embedded into the very same
    document, where the class names are global (and where the embedding
    document hence can declare all classes once on its own)  */
interface Styler {
    text: (fill: ConfigEmbedded, size: ConfigFontSize | number,
        options?: { bold?: boolean, middle?: boolean, halo?: boolean }) => string
    box:  (fill: ConfigEmbedded, stroke: ConfigEmbedded, width: number) => string
}

/*  a rectangular area, given by its top-left and bottom-right corners  */
type Box = [ number, number, number, number ]

/*  the placement of a group tag in the top-left corner of its group box  */
const TAG_DX = 18  /*  left offset of the group tag  */
const TAG_DY = 12  /*  top offset of the group tag   */

/*  the half width of the box an edge line segment occupies  */
const LINE_PAD = 2

/*  the clearance a label keeps from a foreign edge line, as a label
    merely not overlapping such a line still reads as its annotation  */
const LINE_GAP = 12

/*  the gap between two arity labels set back one behind the other along
    one and the same edge line, and the number of such setbacks tried  */
const ARITY_STEP = 8
const ARITY_BACK = 3

/*  track occupied areas (node boxes and already placed labels) to
    let subsequent labels dodge into a collision-free position, and the
    edge lines (their segments and crossing hops) to let the labels at
    least prefer the position covering the fewest lines (the returned
    "occupied" array grows with every claimed label box and hence also
    serves as the box input of the overall bounding box)  */
const labelPlacer = (
    layout:    Layout,
    hops:      Map<number, number[]>[],
    hopRadius: number,
    config:    Config
): { claim: (candidates: Box[], edge: number, dodge?: boolean) => Box, occupied: Box[] } => {
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
            c.x + TAG_DX + textWidth(c.node.name, FS_GROUP), c.y + containerHead(c.node, config) ])

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

    /*  claim the candidate box colliding with the fewest occupied
        areas and, among those, with the fewest edge lines (earlier
        candidates win ties, so the first collision-free one is taken),
        where the own edge lines count on touch only, as the label sits
        beside its own route by construction, while the foreign ones
        count already within a clearance, so a label hugging a foreign
        line loses against one staying with its own edge. A claim with
        "dodge" unset weighs the lines not at all, as its candidates are
        ordered by a proximity which matters more than a crossed line,
        which the halo of the label keeps readable anyway  */
    const collisions = (boxes: Box[], box: Box): number =>
        boxes.filter((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]).length
    const crossings = (box: Box, edge: number): number => {
        const near: Box = [ box[0] - LINE_GAP, box[1] - LINE_GAP, box[2] + LINE_GAP, box[3] + LINE_GAP ]
        return lines.reduce((n, boxes, i) => n + collisions(boxes, i === edge ? box : near), 0)
    }
    const claim = (candidates: Box[], edge: number, dodge = true): Box => {
        let box    = candidates[0]
        let lowest = Infinity
        for (const c of candidates) {
            const score = collisions(occupied, c) * (lineCount + 1) + (dodge ? crossings(c, edge) : 0)
            if (score < lowest) {
                box    = c
                lowest = score
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
const renderNode = (node: Node, layout: Layout, style: NodeStyle, styler: Styler,
    config: Config): string[] => {
    const { cx, cy, boxW, boxH, contentH } = layout
    const w     = boxW.get(node.id)!
    const h     = boxH.get(node.id)!
    const x     = cx(node.id) - w / 2
    const y     = cy(node.id) - h / 2
    const lines = linesOfNode(node, config)
    const url   = urlOf(node)
    const parts: string[] = []
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ` +
        `class="${styler.box(style.fill, style.stroke, 4)}"` +
        `${style.dash !== undefined ? ` stroke-dasharray="${escapeXML(style.dash)}"` : ""}/>`)

    /*  vertically center the textual content block within the box, with
        the optional type lines shifting the name and attributes down and
        the additional wrapped name lines shifting the attributes down  */
    const ty    = cy(node.id) - contentH.get(node.id)! / 2
    const th    = lines.type.length * TYPE_H(config)
    const nh    = (lines.name.length - 1) * NAME_H(config)
    const asc   = config["size-font-node"] * 0.36
    const nameY = lines.attrs.length > 0 ?
        ty + th + MIN_H(config) / 2 + asc : cy(node.id) + th / 2 + asc - nh / 2
    lines.type.forEach((line, k) => {
        parts.push(`<text x="${cx(node.id)}" ` +
            `y="${nameY - TYPE_D(config) - (lines.type.length - 1 - k) * TYPE_H(config)}" ` +
            `class="${styler.text(style.text, "size-font-type", { middle: true })}">${escapeXML(line)}</text>`)
    })
    lines.name.forEach((line, k) => {
        parts.push(`<text x="${cx(node.id)}" y="${nameY + k * NAME_H(config)}" ` +
            `class="${styler.text(style.text, "size-font-node", { bold: true, middle: true })}">` +
            `${escapeXML(line)}</text>`)
    })
    lines.attrs.forEach((line, k) => {
        parts.push(`<text x="${cx(node.id)}" ` +
            `y="${ty + th + nh + MIN_H(config) + ATTR_P + k * ATTR_H(config)}" ` +
            `class="${styler.text(style.text, "size-font-prop", { middle: true })}">${escapeXML(line)}</text>`)
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
const renderEdgeLabels = (edge: Edge, poly: Poly, claim: (candidates: Box[], dodge?: boolean) => Box,
    styler: Styler, config: Config): string[] => {
    const parts: string[] = []
    if (edge.name !== undefined) {
        const w = textWidth(edge.name, config["size-font-edge"])
        const h = config["size-font-edge"] + 4
        const candidates: Box[] = []
        for (const f of [ 0.50, 0.40, 0.60, 0.30, 0.70, 0.20, 0.80 ]) {
            const p = pointAt(poly, f)
            if (p.horizontal) {
                candidates.push([ p.x - w / 2, p.y - 3 - h,  p.x + w / 2, p.y - 3     ])
                candidates.push([ p.x - w / 2, p.y + 3,      p.x + w / 2, p.y + 3 + h ])
            }
            else {
                candidates.push([ p.x + 5,     p.y - h / 2,  p.x + 5 + w, p.y + h / 2 ])
                candidates.push([ p.x - 5 - w, p.y - h / 2,  p.x - 5,     p.y + h / 2 ])
            }
        }
        const box = claim(candidates)
        parts.push(`<text x="${(box[0] + box[2]) / 2}" y="${box[3] - 3}" ` +
            `class="${styler.text("color-edge-name", "size-font-edge", { middle: true, halo: true })}">` +
            `${escapeXML(edge.name)}</text>`)
    }
    if (edge.arity !== undefined) {
        const w    = textWidth(edge.arity, config["size-font-arity"])
        const h    = arityHeight(config)
        const p    = pointAt(poly, 1.0)
        const prev = pointAt(poly, 0.999)

        /*  set the arity back from the arrow head along the final
            segment and place it beside the line, so an edge approaching
            vertically keeps its arity next to its own arrow, offering
            both sides at every further setback, which steps by the label
            extent along the segment, as a shorter step would leave the
            label on top of the very label it dodges  */
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

        /*  an arity claims its position without dodging the edge lines,
            as the neighboring ports of a node run closer than any
            clearance anyway and it is the very setback from its own
            arrow head which attaches it to its edge, so a line crossed
            beneath its halo weighs less than a drift away from that arrow  */
        const box = claim(candidates, false)
        parts.push(`<text x="${(box[0] + box[2]) / 2}" y="${box[3] - 3}" ` +
            `class="${styler.text("color-edge-arity", "size-font-arity", { middle: true, halo: true })}">` +
            `${escapeXML(edge.arity)}</text>`)
    }
    return parts
}

/*  generate the SVG fragments for a single group box and its tag
    in the top-left corner  */
const renderGroup = (group: GroupBox, styler: Styler): string[] => [
    `<rect x="${group.x}" y="${group.y}" width="${group.w}" height="${group.h}" rx="12" ` +
        `class="${styler.box("color-group-box", "color-group-border", 3)}"/>`,
    `<text x="${group.x + TAG_DX}" y="${group.y + TAG_DY + FS_GROUP}" ` +
        `class="${styler.text("color-group-name", FS_GROUP, { bold: true })}">${escapeXML(group.name)}</text>`
]

/*  generate the SVG fragments for a single container box and its tag
    in the top-left corner, with the optional type line above the name
    (a container with a "url" attribute becomes a hyperlink covering
    the whole box)  */
const renderContainer = (c: ContainerBox, styler: Styler, config: Config): string[] => {
    const type  = typeOf(c.node)
    const url   = urlOf(c.node)
    const parts = [
        `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="12" ` +
            `class="${styler.box("color-container-box", "color-container-border", 3)}" ` +
            "stroke-dasharray=\"10 6\"/>",
        ...(type !== undefined ? [
            `<text x="${c.x + TAG_DX}" y="${c.y + TAG_DY + config["size-font-type"]}" ` +
                `class="${styler.text("color-container-name", "size-font-type")}">${escapeXML(type)}</text>`
        ] : []),
        `<text x="${c.x + TAG_DX}" y="${c.y + containerHead(c.node, config) - HEAD_H + TAG_DY + FS_GROUP}" ` +
            `class="${styler.text("color-container-name", FS_GROUP, { bold: true })}">` +
            `${escapeXML(c.node.name)}</text>`
    ]
    if (url === undefined)
        return parts
    return [ `<a href="${escapeXML(url)}" xlink:href="${escapeXML(url)}">`, ...parts, "</a>" ]
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
    const color = (key: ConfigEmbedded): string => cssValueOf(explicit, key)

    /*  derive the collision-free identifiers of this SVG document  */
    const prefix  = idPrefix(seed)
    const idArrow = `${prefix}-arrow`

    /*  resolve the configured font into the rendered font family stack  */
    const { family, embed, weight } = resolveFont(config)
    const stack = Object.hasOwn(explicit, "font-family") ?
        `'${escapeCSS(family)}'` :
        `var(--gradia-font-family, '${escapeCSS(family)}')`
    const font = `${stack}, ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif`

    /*  collect the CSS classes the rendered elements reference (the
        halo behind an edge label keeps it readable on top of a line)  */
    const rules = new Map<string, string>()
    const classOf = (decls: string): string => {
        let name = rules.get(decls)
        if (name === undefined) {
            name = `gradia-${new UUID(5, NS_GRADIA, decls).format("b16").toLowerCase().slice(0, 8)}`
            rules.set(decls, name)
        }
        return name
    }
    const styler: Styler = {
        text: (fill, size, options = {}) => classOf(
            `font-family: ${font}; ` +
            `font-size: ${typeof size === "number" ? `${size}px` : cssSizeOf(config, size)}; ` +
            (options.bold   ? "font-weight: 600; "    : "") +
            (options.middle ? "text-anchor: middle; " : "") +
            `fill: ${color(fill)}` +
            (options.halo ? `; stroke: ${color("color-edge-halo")}; stroke-width: 4.5; ` +
                "paint-order: stroke; stroke-linejoin: round" : "")),
        box: (fill, stroke, width) => classOf(
            `fill: ${color(fill)}; stroke: ${color(stroke)}; stroke-width: ${width}`)
    }
    const classEdge  = classOf(`fill: none; stroke: ${color("color-edge-line")}; stroke-width: 3`)
    const classArrow = classOf(`fill: ${color("color-edge-line")}`)

    /*  detect the edge crossings requiring rendered hops  */
    const hops = computeHops(polys)

    /*  prepare the collision-free placement of the edge labels  */
    const { claim, occupied } = labelPlacer(layout, hops, config["size-edge-hop-radius"], config)

    /*  generate the SVG fragments for the edges (paths below, labels above)  */
    const svgEdges:  string[] = []
    const svgLabels: string[] = []
    edges.forEach((edge, i) => {
        svgEdges.push(`<path d="${pathOf(polys[i], hops[i],
            config["size-edge-corner-radius"], config["size-edge-hop-radius"])}" ` +
            `class="${classEdge}" marker-end="url(#${idArrow})"/>`)
        svgLabels.push(...renderEdgeLabels(edge, polys[i], (c, dodge) => claim(c, i, dodge), styler, config))
    })

    /*  generate the SVG fragments for the node boxes  */
    const svgNodes = nodes.flatMap((node) => renderNode(node, layout, styleOf(node), styler, config))

    /*  generate the SVG fragments for the group boxes (drawn below
        everything else) and the container boxes (drawn below the edges
        and nodes, an outer box before its nested ones)  */
    const svgGroups     = groups.flatMap((group) => renderGroup(group, styler))
    const svgContainers = containers.flatMap((c) => renderContainer(c, styler, config))

    /*  determine the overall bounding box of all rendered elements  */
    const groupBoxes: Box[] = groups.map((group) =>
        [ group.x, group.y, group.x + group.w, group.y + group.h ])
    const containerBoxes: Box[] = containers.map((c) =>
        [ c.x, c.y, c.x + c.w, c.y + c.h ])
    const vb = viewBoxOf(layout, [ ...occupied, ...groupBoxes, ...containerBoxes ], config["size-canvas-margin"])

    /*  assemble the final SVG document (with one CSS rule per line)  */
    return [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" " +
            `viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${vb.w}" height="${vb.h}">`,
        "<defs>",
        "<style>",
        ...(embed !== undefined ? [
            `@font-face { font-family: "${escapeXML(escapeCSS(family))}"; ` +
                (weight !== undefined ? `font-weight: ${escapeXML(escapeCSS(weight))}; ` : "") +
                `src: url(data:font/woff2;base64,${embed}) format("woff2"); }`
        ] : []),
        ...Array.from(rules, ([ decls, name ]) => `.${name} { ${escapeXML(decls)} }`),
        "</style>",
        `<marker id="${idArrow}" viewBox="0 0 10 10" refX="9" refY="5" ` +
            "markerWidth=\"21\" markerHeight=\"21\" markerUnits=\"userSpaceOnUse\" " +
            "orient=\"auto-start-reverse\">",
        `<path d="M 0 1 L 9 5 L 0 9 z" class="${classArrow}"/>`,
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

