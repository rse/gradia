/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Attr, Node }                              from "./gradia-api-model.js"
import { Config }                                  from "./gradia-api-config.js"
import { NodeStyle, FS_NAME, FS_TYPE, FS_ATTR, textWidth, textWrap }
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

/*  container box head geometry (the head holds the name tag and the
    optional type line above it)  */
export const HEAD_H = 34  /*  height of the container box head        */
export const HEAD_T = 20  /*  extra head height of a type line        */
export const containerHead = (node: Node): number =>
    HEAD_H + (typeOf(node) !== undefined ? HEAD_T : 0)

/*  the special attributes consumed by the renderers instead of being
    rendered as node box text lines  */
const ATTRS_SPECIAL = new Set([ "url", "type", "primary", "group", "parent", "container" ])

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

/*  node box text metrics (shared by the measuring and the text placement)  */
export const PAD_W  = 18  /*  left/right node box text padding          */
export const MIN_H  = 56  /*  minimum node box height                   */
export const NAME_H = 34  /*  height of an additional name line         */
export const ATTR_H = 30  /*  height of a single attribute line         */
export const ATTR_P = 12  /*  top padding of the attribute block        */
export const ATTR_B = 20  /*  bottom padding of the attribute block     */
export const TYPE_H = 26  /*  extra height of a single type line        */
export const TYPE_D = 36  /*  baseline distance of the type to the name */

/*  the text lines rendered inside a node box  */
export interface NodeLines {
    name:  string[]
    type:  string[]
    attrs: string[]
}

/*  break the textual content of a node into its rendered lines, word-wrapped
    to the configured maximum box width (shared by the measuring and the text
    placement, so both can never disagree on the resulting line count)  */
export const linesOfNode = (node: Node, config: Config): NodeLines => {
    const max  = config["size-node-width-max"] > 0 ?
        config["size-node-width-max"] - PAD_W * 2 : 0
    const type = typeOf(node)
    return {
        name:  textWrap(node.name, FS_NAME, max),
        type:  type !== undefined ? textWrap(type, FS_TYPE, max) : [],
        attrs: attrsOfNode(node).flatMap((attr) =>
            textWrap(`${attr.key}: ${attr.val}`, FS_ATTR, max))
    }
}

/*  determine node box sizes from their textual content
    (boxes are scaled up in height by a per-node factor, but never
    below the content height, to give the edges more attachment
    room), except for the nodes
    of a fixed size (the container placeholders and gate nodes
    of a containment level), which are taken as given  */
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
        const w = Math.max(0,
            ...lines.name.map((line)  => textWidth(line, FS_NAME)),
            ...lines.type.map((line)  => textWidth(line, FS_TYPE)),
            ...lines.attrs.map((line) => textWidth(line, FS_ATTR)))
        const h = MIN_H + (lines.name.length - 1) * NAME_H + lines.type.length * TYPE_H +
            (lines.attrs.length > 0 ? ATTR_P + (lines.attrs.length - 1) * ATTR_H + ATTR_B : 0)
        boxW.set(node.id, Math.max(config["size-node-width-min"], Math.ceil(w) + PAD_W * 2))
        boxH.set(node.id, Math.max(h, Math.ceil(h * scaleOf(node))))
        contentH.set(node.id, h)
    }
    return { boxW, boxH, contentH }
}

