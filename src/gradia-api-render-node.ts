/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Attr, Node }                              from "./gradia-api-model.js"
import { Config, ConfigFontSize }                  from "./gradia-api-config.js"
import { NodeStyle, NodeShape, textWidth, textWrap }
    from "./gradia-api-render-base.js"

/*  the special "primary" annotation (rendered as a distinct node coloring)  */
export const isPrimary = (node: Node): boolean =>
    node.attrs.findLast((attr) => attr.key === "primary")?.val === "true"

/*  the default node box coloring (primary node boxes get a distinct one)  */
export const defaultStyleOf = (node: Node): NodeStyle =>
    isPrimary(node) ? {
        fill:   "color-node-primary-box",
        stroke: "color-node-primary-border",
        text:   "color-node-primary-name"
    } : {
        fill:   "color-node-regular-box",
        stroke: "color-node-regular-border",
        text:   "color-node-regular-name"
    }

/*  the special "type" annotation (rendered above the node name)  */
export const typeOf = (node: Node): string | undefined =>
    node.attrs.findLast((attr) => attr.key === "type")?.val

/*  the special "parent" annotation (nesting the node into a container node)  */
export const parentOf = (node: Node): string | undefined =>
    node.attrs.findLast((attr) => attr.key === "parent")?.val

/*  the special "container" annotation (the diagram type laying out the
    members of the node, marking even a member-less node as a container)  */
export const containerTypeOf = (node: Node): string | undefined =>
    node.attrs.findLast((attr) => attr.key === "container")?.val

/*  container box head geometry (the head holds the name tag, the
    optional type line above it, and, for a container drawn in a node
    style, e.g. a composite state, its attribute lines below it, padded
    for the line dividing them from the name tag, plus some air below the
    line dividing the head from the members)  */
export const HEAD_H = 34  /*  height of the container box head        */
export const HEAD_X = 12  /*  extra air below the head of a boxed one  */
export const HEAD_T = (config: Config): number =>
    config["size-font-type"] + 4  /*  extra head height of a type line  */
export const containerHead = (node: Node, config: Config, boxed = false): number => {
    const n = boxed ? attrsOfNode(node).length : 0
    return HEAD_H + (typeOf(node) !== undefined ? HEAD_T(config) : 0) +
        (n > 0 ? ATTR_P + n * ATTR_H(config) : 0) + (boxed ? HEAD_X : 0)
}

/*  the special "order" annotation (the explicit top-down placement
    order of the node, a finite number, an invalid value being ignored)  */
export const orderOf = (node: Node): number | undefined => {
    const val = node.attrs.findLast((attr) => attr.key === "order")?.val
    const num = val !== undefined && val.trim() !== "" ? Number(val) : NaN
    return Number.isFinite(num) ? num : undefined
}

/*  the special "cluster" annotation (the "/"-separated path of the nested
    clusters a node belongs to within the one diagram, outermost first,
    for the diagram types drawing clusters, and ignored by the others)  */
export const clusterOf = (node: Node): string[] | undefined => {
    const val = node.attrs.findLast((attr) => attr.key === "cluster")?.val
    return val?.split("/").map((name) => name.trim()).filter((name) => name !== "")
}

/*  the special attributes consumed by the renderers instead of being
    rendered as node box text lines  */
const ATTRS_SPECIAL = new Set([ "url", "type", "primary", "group", "parent", "container", "order",
    "badge", "multiple", "cluster", "mark" ])

/*  the special "mark" annotation (the violation marking of a node, as
    set by the analysis of a "state" or "petri" diagram, an unknown value
    being ignored), drawn with a dashed border for an "unreachable" or a
    "dead" node, whose outgoing edges are marked, too, and a solid one for
    a "dead-end", an "incomplete", an "unbounded", or a "non-live" node  */
const nodeMarks = [ "unreachable", "dead-end", "incomplete", "dead", "unbounded", "non-live" ] as const
export type NodeMark = typeof nodeMarks[number]
export const markOf = (node: Node): NodeMark | undefined => {
    const val = node.attrs.findLast((attr) => attr.key === "mark")?.val
    return nodeMarks.find((mark) => mark === val)
}

/*  whether a node mark lets the node never be entered, i.e., marks its
    outgoing edges, too  */
export const isDormant = (mark: NodeMark | undefined): boolean =>
    mark === "unreachable" || mark === "dead"

/*  the node coloring of a marked node: the border in the violation color
    (unless the marking of the violations is disabled)  */
export const markedStyleOf = (node: Node, style: NodeStyle, config: Config): NodeStyle => {
    const mark = config["mark-violation"] ? markOf(node) : undefined
    if (mark === undefined)
        return style
    return { ...style, stroke: "color-mark-violation", ...(isDormant(mark) ? { dash: "10 6" } : {}) }
}

/*  the token row of a place of a "petri" diagram below its name: its
    minimum height, the radius of a token dot, the largest number of
    tokens drawn as dots (more being drawn as their count), and the dot
    offsets (in units of the distance of neighboring dots) of every
    drawn number of tokens, arranged like the faces of a die (except two
    tokens, side by side)  */
export const TOKEN_H = (config: Config): number =>
    config["size-font-prop"] + 10
export const TOKEN_R = (config: Config): number =>
    config["size-font-prop"] * 0.25
export const TOKEN_DOTS = 6
const tokenFaces: [ number, number ][][] = [
    [],
    [ [ 0, 0 ] ],
    [ [ -0.5, 0 ], [ 0.5, 0 ] ],
    [ [ -1, -1 ], [ 0, 0 ], [ 1, 1 ] ],
    [ [ -1, -1 ], [ 1, -1 ], [ -1, 1 ], [ 1, 1 ] ],
    [ [ -1, -1 ], [ 1, -1 ], [ 0, 0 ], [ -1, 1 ], [ 1, 1 ] ],
    [ [ -0.6, -1 ], [ 0.6, -1 ], [ -0.6, 0 ], [ 0.6, 0 ], [ -0.6, 1 ], [ 0.6, 1 ] ]
]

/*  the offsets of the token dots of a place from the middle of its token
    row (none beyond the number of tokens drawn as dots)  */
export const tokenDots = (tokens: number, config: Config): [ number, number ][] => {
    const step = TOKEN_R(config) * 3
    return (tokenFaces[tokens] ?? []).map(([ x, y ]) => [ x * step, y * step ])
}

/*  the side padding of the text lines of a place within its circle, and
    the gap of the inner circle of a sink place to its outer circle  */
export const PLACE_PAD  = 8
export const PLACE_RING = 6

/*  the geometry of a pseudo-state shape centered in its box of the half
    size "a" (the smaller half extent of the box): the radius of the dot of
    an initial state or a junction, the outer radius of the bullseye of a
    final state and the circle of a history state, an entry point, or an
    exit point, the half diagonal of the diamond of a choice and the cross
    of a terminate state, and the half width of the bar of a fork or join
    (filling its box), plus the reach of its outline across from its
    center at the offset "d" from it along a side  */
export const shapeRadius = (shape: NodeShape, a: number): number =>
    shape === "initial" || shape === "junction" ? a * 0.75 : shape === "terminate" ? a * 0.7 : a
export const shapeReach = (shape: NodeShape, a: number, d: number): number => {
    const r = shapeRadius(shape, a)
    return shape === "fork" || shape === "join" ? r :
        shape === "choice" || shape === "terminate" ? r - Math.abs(d) : Math.sqrt(Math.max(0, r * r - d * d))
}

/*  the special "badge" annotation (the icon in a badge at the left end
    inside the node box, an unknown value being ignored)  */
const nodeBadges = [ "person", "team", "bot", "device", "mobile", "browser", "service", "function",
    "api", "code", "package", "database", "cache", "queue", "document", "mail", "communication", "clock",
    "security", "cloud", "network" ] as const
export type NodeBadge = typeof nodeBadges[number]
export const BADGE_F = 0.6  /*  radius of a badge relative to its label font size   */
export const BADGE_X = 15   /*  gap between the left end of a box and its badge     */
export const badgeOf = (node: Node): NodeBadge | undefined => {
    const val = node.attrs.findLast((attr) => attr.key === "badge")?.val
    return nodeBadges.find((badge) => badge === val)
}

/*  the radius of a badge beside a label of the given font size, so it
    keeps its look relative to the label at every font size  */
export const badgeRadius = (fs: number): number =>
    fs * BADGE_F

/*  the room a badge claims at the left end of its box, in front of the
    left text padding (none for a node without a badge)  */
export const badgeRoom = (node: Node, config: Config): number =>
    badgeOf(node) !== undefined ? BADGE_X + badgeRadius(config["size-font-node"]) * 2 : 0

/*  the special "multiple" annotation (the node box drawn as a front box
    with copies behind it, offset towards the bottom-right)  */
export const MULTI_OFF = 16  /*  offset of the rearmost copy behind the front box  */
export const isMultiple = (node: Node): boolean =>
    node.attrs.findLast((attr) => attr.key === "multiple")?.val === "true"

/*  split the attributes rendered as text lines from the special ones  */
export const attrsOfNode = (node: Node): Attr[] =>
    node.attrs.filter((attr) => !ATTRS_SPECIAL.has(attr.key))

/*  the special "url" attribute (rendered as a hyperlink on the whole node
    box, restricted to relative URLs and safe schemes, as the generated
    SVG anchor would otherwise execute an injected "javascript:" URL)  */
const URL_SCHEME = /^\s*([A-Za-z][A-Za-z0-9+.-]*):/
const URL_SAFE   = new Set([ "http", "https", "mailto" ])
export const urlOf = (node: Node): string | undefined => {
    const raw = node.attrs.findLast((attr) => attr.key === "url")?.val
    if (raw === undefined)
        return undefined

    /*  strip control characters, as browsers remove them before
        resolving the URL and they would otherwise hide an unsafe scheme  */
    const url    = raw.replace(/[\u0000-\u001F\u007F]/g, "")
    const scheme = URL_SCHEME.exec(url)
    if (scheme !== null && !URL_SAFE.has(scheme[1].toLowerCase()))
        return undefined
    return url
}

/*  node box text metrics (shared by the measuring and the text
    placement), where the vertical ones track the font size of the text
    they space out, so that a configured font size never lets a line
    collide with its neighbor  */
export const PAD_W  = 18  /*  left/right node box text padding          */
export const ATTR_P = 12  /*  top padding of the attribute block        */
export const ATTR_B = 20  /*  bottom padding of the attribute block     */

/*  minimum node box height (one name line plus its vertical padding)  */
export const MIN_H = (config: Config): number =>
    config["size-font-node"] + 26

/*  height of an additional name line  */
export const NAME_H = (config: Config): number =>
    config["size-font-node"] + 4

/*  height of a single attribute line  */
export const ATTR_H = (config: Config): number =>
    config["size-font-prop"] + 8

/*  extra height of a single type line  */
export const TYPE_H = (config: Config): number =>
    config["size-font-type"] + 10

/*  baseline distance of the type line to the name line (the cap height
    of the name plus the line box of the type)  */
export const TYPE_D = (config: Config): number =>
    config["size-font-node"] * 0.72 + config["size-font-type"] * 0.90

/*  the text lines rendered inside a node box  */
export interface NodeLines {
    name:  string[]
    type:  string[]
    attrs: string[]
}

/*  break the textual content of a node into its rendered lines, word-wrapped
    to the configured maximum box width, less the room of its badge (shared by
    the measuring and the text placement, so both can never disagree on the
    resulting line count)  */
export const linesOfNode = (node: Node, config: Config): NodeLines => {
    const max  = config["size-node-width-max"] > 0 ?
        config["size-node-width-max"] - PAD_W * 2 - badgeRoom(node, config) : 0
    const type = typeOf(node)
    return {
        name:  textWrap(node.name, config["size-font-node"], max),
        type:  type !== undefined ? textWrap(type, config["size-font-type"], max) : [],
        attrs: attrsOfNode(node).flatMap((attr) =>
            textWrap(`${attr.key}: ${attr.val}`, config["size-font-prop"], max))
    }
}

/*  the width of the widest text line of a node box  */
export const linesWidth = (lines: NodeLines, config: Config): number =>
    Math.max(0,
        ...lines.name.map((line)  => textWidth(line, config["size-font-node"])),
        ...lines.type.map((line)  => textWidth(line, config["size-font-type"])),
        ...lines.attrs.map((line) => textWidth(line, config["size-font-prop"])))

/*  determine node box sizes from their textual content (boxes are
    scaled up in height by a per-node factor, but never below the
    content height, to give the edges more attachment room), except
    for the nodes of a fixed size (the container placeholders and gate
    nodes of a containment level), which are taken as given  */
export const measureNodes = (
    nodes:   Node[],
    config:  Config,
    scaleOf: (node: Node) => number,
    fixed?:  Map<string, { w: number, h: number }>
): { boxW: Map<string, number>, boxH: Map<string, number>, contentH: Map<string, number> } => {
    /*  the resulting node box dimensions  */
    const boxW     = new Map<string, number>()
    const boxH     = new Map<string, number>()
    const contentH = new Map<string, number>()

    /*  measure the text content of every node  */
    for (const node of nodes) {
        const size = fixed?.get(node.id)
        if (size !== undefined) {
            boxW.set(node.id, size.w)
            boxH.set(node.id, size.h)
            contentH.set(node.id, size.h)
            continue
        }
        const lines = linesOfNode(node, config)
        const w = linesWidth(lines, config)
        const h = MIN_H(config) + (lines.name.length - 1) * NAME_H(config) +
            lines.type.length * TYPE_H(config) +
            (lines.attrs.length > 0 ? ATTR_P + (lines.attrs.length - 1) * ATTR_H(config) + ATTR_B : 0)
        const bw = Math.max(config["size-node-width-min"], Math.ceil(w) + PAD_W * 2 + badgeRoom(node, config))
        const bh = Math.max(h, Math.ceil(h * scaleOf(node)))

        /*  a multiple node claims the room of the copies behind its front box  */
        const multi = isMultiple(node) ? MULTI_OFF : 0
        boxW.set(node.id, bw + multi)
        boxH.set(node.id, bh + multi)
        contentH.set(node.id, h)
    }
    return { boxW, boxH, contentH }
}

/*  a text line (or the row of token dots) of a place of a "petri"
    diagram: its text and font (or its number of dots), its estimated
    width and height, and the offset of its middle from the circle center  */
export interface PlaceLine {
    text: string
    size: ConfigFontSize
    bold: boolean
    dots: number
    w:    number
    h:    number
    dy:   number
}

/*  the lines of a place, stacked and centered on its circle: its type
    lines, its bold name lines in the attribute font size, its token row,
    its capacity (in the usual notation "K = <count>"), and its attribute
    lines, the latter two in the type font size, so a place stays
    optically lighter than the boxes of the transitions  */
export const placeLines = (node: Node, tokens: number, capacity: number | undefined,
    config: Config): PlaceLine[] => {
    const fsT   = config["size-font-type"]
    const fsP   = config["size-font-prop"]
    const lines = linesOfNode(node, { ...config, "size-font-node": fsP, "size-font-prop": fsT })
    const text  = (text: string, size: ConfigFontSize, bold: boolean, h: number): PlaceLine =>
        ({ text, size, bold, dots: 0, w: textWidth(text, config[size], bold), h, dy: 0 })
    const dots  = (): PlaceLine => {
        const extent = (k: number) =>
            Math.max(...tokenDots(tokens, config).map((dot) => Math.abs(dot[k]))) * 2 + TOKEN_R(config) * 2
        return { text: "", size: "size-font-prop", bold: false, dots: tokens,
            w: extent(0), h: Math.max(TOKEN_H(config), extent(1) + 10), dy: 0 }
    }
    const stack: PlaceLine[] = [
        ...lines.type.map((line) => text(line, "size-font-type", false, fsT + 4)),
        ...lines.name.map((line) => text(line, "size-font-prop", true, fsP + 4)),
        ...(tokens > TOKEN_DOTS ? [ text(String(tokens), "size-font-prop", true, TOKEN_H(config)) ] :
            tokens > 0 ? [ dots() ] : []),
        ...(capacity !== undefined ? [ text(`K = ${capacity}`, "size-font-type", false, fsT + 6) ] : []),
        ...lines.attrs.map((line) => text(line, "size-font-type", false, fsT + 6))
    ]
    let y = -stack.reduce((sum, line) => sum + line.h, 0) / 2
    for (const line of stack) {
        line.dy = y + line.h / 2
        y += line.h
    }
    return stack
}

/*  the radius of the circle of a place enclosing all of its lines, each
    with the side padding  */
export const placeRadius = (lines: PlaceLine[]): number =>
    Math.max(0, ...lines.map((line) => Math.hypot(line.w / 2 + PLACE_PAD, Math.abs(line.dy) + line.h / 2)))

