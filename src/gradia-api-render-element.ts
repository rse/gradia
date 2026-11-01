/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Node }                                             from "./gradia-api-model.js"
import { Config }                                           from "./gradia-api-config.js"
import { NodeStyle, NodeShape, Layout, GroupBox, ContainerBox, Styler,
    FS_GROUP, TAG_DX, TAG_DY, REGION_GAP, REGION_HEAD, escapeXML }
    from "./gradia-api-render-base.js"
import { Shape }                                            from "./gradia-api-render-shape.js"
import { linesOfNode, linesWidth, urlOf, typeOf, containerHead, badgeOf, badgeRoom, isMultiple,
    MULTI_OFF, BADGE_X, PAD_W, badgeRadius, type NodeBadge, MIN_H, NAME_H, ATTR_H, ATTR_P, TYPE_H, TYPE_D, HEAD_H,
    markOf, markedStyleOf, shapeRadius, attrsOfNode, HEAD_X, TOKEN_R, tokenDots, placeLines,
    PLACE_RING }
    from "./gradia-api-render-node.js"
import { renderBadge }                                      from "./gradia-api-render-icon.js"

/*  the offset of the line dividing the head of a container drawn in a
    node style from its members, below the head (clear of the descenders
    of its name, but within the padding above the members)  */
const HEAD_D = 18

/*  generate the SVG fragments of the outline of a node box: a single
    box, or, for a multiple node, a front box with two copies behind it,
    offset towards the bottom-right, and an optional badge inside the
    (front) box, vertically centered, at a fixed distance from its left end  */
const renderOutline = (badge: NodeBadge | undefined, r: number, multi: number, x: number, y: number,
    w: number, h: number, style: NodeStyle, styler: Styler): string[] => {
    const cls   = styler.box(style.fill, style.stroke, 4)
    const dash  = style.dash !== undefined ? ` stroke-dasharray="${escapeXML(style.dash)}"` : ""
    const parts = (multi > 0 ? [ multi, multi / 2, 0 ] : [ 0 ]).map((d) =>
        `<rect x="${x + d}" y="${y + d}" width="${w - multi}" height="${h - multi}" rx="6" class="${cls}"${dash}/>`)
    if (badge !== undefined)
        parts.push(...renderBadge(badge, x + BADGE_X + r, y + (h - multi) / 2, r, style, styler))
    return parts
}

/*  generate the SVG fragments of a pseudo-state shape centered on the
    given point within its box of the given size (see "shapeRadius"): the
    bullseye of a final state as a dot within a ring, the circle of a
    history state with its "H" (or "H*") inside, and the bar of a fork or
    join filling its box  */
const renderPseudo = (shape: NodeShape, x: number, y: number, w: number, h: number, style: NodeStyle,
    styler: Styler, config: Config): string[] => {
    const cls  = styler.box(style.fill, style.stroke, 2)
    const dash = style.dash !== undefined ? ` stroke-dasharray="${escapeXML(style.dash)}"` : ""
    const r    = shapeRadius(shape, Math.min(w, h) / 2)
    if (shape === "choice")
        return [ `<polygon points="${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}" class="${cls}"${dash}/>` ]
    else if (shape === "fork" || shape === "join")
        return [ `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2" class="${cls}"${dash}/>` ]
    else if (shape === "final")
        return [ `<circle cx="${x}" cy="${y}" r="${r - 1}" ` +
            `class="${styler.box("color-container-box", style.stroke, 2)}"${dash}/>`,
        `<circle cx="${x}" cy="${y}" r="${r / 2}" class="${cls}"/>` ]
    else if (shape === "history" || shape === "deep-history")
        return [ `<circle cx="${x}" cy="${y}" r="${r - 1}" class="${cls}"${dash}/>`,
            `<text x="${x}" y="${y + config["size-font-prop"] * 0.36}" ` +
            `class="${styler.text(style.text, "size-font-prop", { bold: true, middle: true })}">` +
            `${shape === "history" ? "H" : "H*"}</text>` ]
    else if (shape === "entry-point" || shape === "exit-point") {
        /*  an entry point as a hollow circle, an exit point crossed out  */
        const d = (r - 1) * Math.SQRT1_2
        return [ `<circle cx="${x}" cy="${y}" r="${r - 1}" ` +
            `class="${styler.box("color-container-box", style.stroke, 2)}"${dash}/>`,
        ...(shape === "exit-point" ? [
            `<path d="M ${x - d} ${y - d} L ${x + d} ${y + d} M ${x - d} ${y + d} L ${x + d} ${y - d}" ` +
                `class="${styler.line(style.stroke, 2)}"/>` ] : []) ]
    }
    else if (shape === "terminate")
        return [ `<path d="M ${x - r} ${y - r} L ${x + r} ${y + r} M ${x - r} ${y + r} L ${x + r} ${y - r}" ` +
            `class="${styler.line(style.stroke, 4)}"${dash}/>` ]
    else
        return [ `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"${dash}/>` ]
}

/*  wrap the SVG fragments into a hyperlink, if a URL is given  */
const linkTo = (url: string | undefined, parts: string[]): string[] =>
    url === undefined ? parts : [ `<a href="${escapeXML(url)}" xlink:href="${escapeXML(url)}">`, ...parts, "</a>" ]

/*  generate the SVG fragments of a place of a "petri" diagram centered on
    the given point: a circle filling its box of the given size (doubled
    for a sink place, i.e. a place where the tokens come to rest), with
    its text lines and token row stacked and centered in it (see
    "placeLines")  */
const renderPlace = (node: Node, x: number, y: number, w: number, h: number, style: NodeStyle,
    styler: Styler, config: Config): string[] => {
    const dash  = style.dash !== undefined ? ` stroke-dasharray="${escapeXML(style.dash)}"` : ""
    const r     = Math.min(w, h) / 2
    const parts = [ `<circle cx="${x}" cy="${y}" r="${r}" class="${styler.box(style.fill, style.stroke, 4)}"${dash}/>` ]
    if (style.sink === true)
        parts.push(`<circle cx="${x}" cy="${y}" r="${r - PLACE_RING}" class="${styler.line(style.stroke, 2)}"${dash}/>`)
    for (const line of placeLines(node, style.tokens ?? 0, style.capacity, config)) {
        for (const [ dx, dy ] of tokenDots(line.dots, config))
            parts.push(`<circle cx="${x + dx}" cy="${y + line.dy + dy}" r="${TOKEN_R(config)}" ` +
                `class="${styler.box(style.text, style.text, 1)}"/>`)
        if (line.dots === 0)
            parts.push(`<text x="${x}" y="${y + line.dy + config[line.size] * 0.36}" ` +
                `class="${styler.text(style.text, line.size, { bold: line.bold, middle: true })}">` +
                `${escapeXML(line.text)}</text>`)
    }
    return linkTo(urlOf(node), parts)
}

/*  generate the SVG fragments for a single node box (a node with a
    "url" attribute becomes a hyperlink covering the whole box, a
    pseudo-state is drawn as its shape, without any texts, and a place
    as its circle)  */
export const renderNode = (node: Node, layout: Layout, style: NodeStyle, styler: Styler,
    config: Config): string[] => {
    const { cx, cy, boxW, boxH, contentH } = layout
    const w     = boxW.get(node.id)!
    const h     = boxH.get(node.id)!
    if (style.shape !== undefined)
        return renderPseudo(style.shape, cx(node.id), cy(node.id), w, h, style, styler, config)
    if (style.tokens !== undefined)
        return renderPlace(node, cx(node.id), cy(node.id), w, h, style, styler, config)
    const x     = cx(node.id) - w / 2
    const y     = cy(node.id) - h / 2
    const lines = linesOfNode(node, config)
    const multi = isMultiple(node) ? MULTI_OFF : 0

    /*  the text sits centered on the front box of a multiple node, but
        shifted right as far as needed to keep it clear of the badge  */
    const half  = linesWidth(lines, config) / 2
    const tx    = Math.max(cx(node.id) - multi / 2, x + badgeRoom(node, config) + PAD_W + half)
    const ty0   = -multi / 2
    const parts = renderOutline(badgeOf(node), badgeRadius(config["size-font-node"]), multi, x, y, w, h,
        style, styler)

    /*  vertically center the textual content block within the box, with
        the optional type lines shifting the name and attributes down and
        the additional wrapped name lines shifting the attributes down  */
    const ty    = cy(node.id) + ty0 - contentH.get(node.id)! / 2
    const th    = lines.type.length * TYPE_H(config)
    const nh    = (lines.name.length - 1) * NAME_H(config)
    const asc   = config["size-font-node"] * 0.36
    const split = style.divided === true && lines.attrs.length > 0
    const lift  = split ? config["size-font-prop"] * 0.3 : 0
    const drop  = split ? config["size-font-prop"] * 0.4 : 0
    const attrY = ty + th + nh + MIN_H(config) + ATTR_P + drop
    const nameY = lines.attrs.length > 0 ?
        ty + th + MIN_H(config) / 2 + asc - lift : cy(node.id) + ty0 + th / 2 + asc - nh / 2
    lines.type.forEach((line, k) => {
        parts.push(`<text x="${tx}" ` +
            `y="${nameY - TYPE_D(config) - (lines.type.length - 1 - k) * TYPE_H(config)}" ` +
            `class="${styler.text(style.text, "size-font-type", { middle: true })}">${escapeXML(line)}</text>`)
    })
    lines.name.forEach((line, k) => {
        parts.push(`<text x="${tx}" y="${nameY + k * NAME_H(config)}" ` +
            `class="${styler.text(style.text, "size-font-node", { bold: true, middle: true })}">` +
            `${escapeXML(line)}</text>`)
    })
    if (split) {
        /*  divide the (dropped) attribute lines from the (lifted) name by a
            line across the box, midway between the descenders of the last
            name line and the ascenders of the first attribute line  */
        const bottom = nameY + nh + config["size-font-node"] * 0.22
        const top    = attrY - config["size-font-prop"] * 0.72
        const dy     = (bottom + top) / 2
        parts.push(`<line x1="${x}" y1="${dy}" x2="${x + w - multi}" y2="${dy}" ` +
            `class="${styler.line(style.stroke, 2)}"/>`)
    }
    lines.attrs.forEach((line, k) => {
        parts.push(`<text x="${tx}" ` +
            `y="${attrY + k * ATTR_H(config)}" ` +
            `class="${styler.text(style.text, "size-font-prop", { middle: true })}">${escapeXML(line)}</text>`)
    })
    return linkTo(urlOf(node), parts)
}

/*  generate the SVG fragments for a single group box and its tag
    in the top-left corner  */
export const renderGroup = (group: GroupBox, styler: Styler): string[] => [
    `<rect x="${group.x}" y="${group.y}" width="${group.w}" height="${group.h}" rx="12" ` +
        `class="${styler.box("color-group-box", "color-group-border", 3)}"/>`,
    `<text x="${group.x + TAG_DX}" y="${group.y + TAG_DY + FS_GROUP}" ` +
        `class="${styler.text("color-group-name", FS_GROUP, { bold: true })}">${escapeXML(group.name)}</text>`
]

/*  generate the SVG fragments for a single container box and its tag
    in the top-left corner, with the optional type line above the name
    (a container with a "url" attribute becomes a hyperlink covering
    the whole box, and a marked container gets its border in the
    violation color), or, for a container drawn in a node style (e.g. a
    composite state), a solid box in that style with its attribute lines
    below its name and its head divided from its members by a line
    across the box (as far as not marked), or, for a region band of a
    composite state, just its name in its head and, except for the first
    band, a dashed line across the given outer box, separating it from
    the band above it  */
export const renderContainer = (c: ContainerBox, styler: Styler, config: Config, outer?: ContainerBox): string[] => {
    if (c.style?.band !== undefined) {
        const [ x1, x2 ] = outer !== undefined ? [ outer.x, outer.x + outer.w ] : [ c.x, c.x + c.w ]
        const parts = [ `<text x="${x1 + TAG_DX}" y="${c.y + REGION_HEAD - 8}" ` +
            `class="${styler.text(c.style.text, "size-font-type")}">${escapeXML(c.node.name)}</text>` ]
        if (c.style.band === "next") {
            const y = c.y - REGION_GAP / 2
            parts.unshift(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" ` +
                `class="${styler.line(c.style.stroke, 2)}" stroke-dasharray="10 6"/>`)
        }
        return parts
    }
    const type   = typeOf(c.node)
    const head   = containerHead(c.node, config, c.style !== undefined)
    const base   = c.y + containerHead(c.node, config) - HEAD_H + TAG_DY + FS_GROUP
    const style  = c.style !== undefined ? markedStyleOf(c.node, c.style, config) : undefined
    const stroke = style?.stroke ?? (config["mark-violation"] && markOf(c.node) !== undefined ?
        "color-mark-violation" : "color-container-border")
    const text   = style?.text ?? "color-container-name"
    const dash   = style !== undefined ? style.dash : "10 6"
    const parts  = [
        `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="12" ` +
            `class="${styler.box(style?.fill ?? "color-container-box", stroke, style !== undefined ? 4 : 3)}"` +
            `${dash !== undefined ? ` stroke-dasharray="${escapeXML(dash)}"` : ""}/>`,
        ...(style !== undefined ? [
            `<line x1="${c.x}" y1="${c.y + head - HEAD_X + HEAD_D}" ` +
                `x2="${c.x + c.w}" y2="${c.y + head - HEAD_X + HEAD_D}" ` +
                `class="${styler.line(stroke, 2)}"/>`
        ] : []),
        ...(type !== undefined ? [
            `<text x="${c.x + TAG_DX}" y="${c.y + TAG_DY + config["size-font-type"]}" ` +
                `class="${styler.text(text, "size-font-type")}">${escapeXML(type)}</text>`
        ] : []),
        `<text x="${c.x + TAG_DX}" y="${base}" ` +
            `class="${styler.text(text, FS_GROUP, { bold: true })}">` +
            `${escapeXML(c.node.name)}</text>`
    ]
    const attrs = style !== undefined ? attrsOfNode(c.node) : []
    if (attrs.length > 0) {
        /*  divide the attribute lines from the name tag by a line across
            the box, midway between the descenders of the name and the
            ascenders of the first attribute line  */
        const first = base + ATTR_P + ATTR_H(config)
        const dy    = (base + FS_GROUP * 0.22 + first - config["size-font-prop"] * 0.72) / 2
        parts.push(`<line x1="${c.x}" y1="${dy}" x2="${c.x + c.w}" y2="${dy}" ` +
            `class="${styler.line(stroke, 2)}"/>`)
        parts.push(...attrs.map((attr, k) =>
            `<text x="${c.x + TAG_DX}" y="${first + k * ATTR_H(config)}" ` +
                `class="${styler.text(text, "size-font-prop")}">` +
                `${escapeXML(`${attr.key}: ${attr.val}`)}</text>`))
    }
    return linkTo(urlOf(c.node), parts)
}

/*  generate the SVG fragment for a single free-standing shape  */
export const renderShape = (shape: Shape, styler: Styler): string => {
    if (shape.kind === "badge")
        return renderBadge(shape.badge, shape.x, shape.y, shape.r, shape.style, styler).join("")
    if (shape.kind === "path") {
        const path = `<path d="M ${shape.x} ${shape.y} ${shape.d}" class="${shape.fill !== undefined ?
            styler.box(shape.fill, shape.stroke, shape.width) : styler.line(shape.stroke, shape.width)}"` +
            `${shape.dash !== undefined ? ` stroke-dasharray="${escapeXML(shape.dash)}"` : ""}/>`
        return shape.title === undefined ? path :
            `<g><title>${escapeXML(shape.title)}</title>${path}</g>`
    }
    const turn = shape.upright === true ? ` transform="rotate(-90 ${shape.x} ${shape.y})"` : ""
    const text = `<text x="${shape.x}" y="${shape.y}"${turn}${shape.anchor !== "start" ? ` text-anchor="${shape.anchor}"` : ""} ` +
        `class="${styler.text(shape.fill, shape.size, { bold: shape.bold, halo: shape.halo !== false })}">` +
        `${escapeXML(shape.text)}</text>`
    return linkTo(shape.url, [ text ]).join("")
}

