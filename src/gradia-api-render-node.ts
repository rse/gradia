/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Attr, Node }                              from "./gradia-api-model.js"
import { Config }                                  from "./gradia-api-config.js"
import { NodeStyle, FS_NAME, FS_TYPE, FS_ATTR, textWidth }
    from "./gradia-api-render-base.js"

/*  the special "primary" annotation (rendered as a distinct node coloring)  */
export const isPrimary = (node: Node): boolean =>
    node.attrs.findLast((attr) => attr.key === "primary")?.val === "true"

/*  the default node box coloring (primary node boxes get a distinct one)  */
export const defaultStyleOf = (config: Config) => (node: Node): NodeStyle =>
    isPrimary(node) ? {
        fill:   config["color-node-primary-box"],
        stroke: config["color-node-primary-border"],
        text:   config["color-node-primary-name"]
    } : {
        fill:   config["color-node-regular-box"],
        stroke: config["color-node-regular-border"],
        text:   config["color-node-regular-name"]
    }

/*  the special "type" annotation (rendered above the node name)  */
export const typeOf = (node: Node): string | undefined =>
    node.attrs.findLast((attr) => attr.key === "type")?.val

/*  split the attributes rendered as text lines from the special
    "url", "type", "primary", and "group" attributes consumed by the renderers  */
export const attrsOfNode = (node: Node): Attr[] =>
    node.attrs.filter((attr) => attr.key !== "url" && attr.key !== "type"
        && attr.key !== "primary" && attr.key !== "group")

/*  the special "url" attribute (rendered as a hyperlink on the whole node
    box, restricted to relative URLs and safe schemes, as the generated
    SVG anchor would otherwise execute an injected "javascript:" URL)  */
const URL_SCHEME = /^\s*([A-Za-z][A-Za-z0-9+.-]*):/
const URL_SAFE   = [ "http", "https", "mailto" ]
export const urlOf = (node: Node): string | undefined => {
    const raw = node.attrs.findLast((attr) => attr.key === "url")?.val
    if (raw === undefined)
        return undefined

    /*  strip control characters, as browsers remove them before
        resolving the URL and they would otherwise hide an unsafe scheme  */
    const url    = raw.replace(/[\u0000-\u001F\u007F]/g, "")
    const scheme = URL_SCHEME.exec(url)
    if (scheme !== null && !URL_SAFE.includes(scheme[1].toLowerCase()))
        return undefined
    return url
}

/*  node box text metrics (shared by the measuring and the text placement)  */
export const MIN_H  = 64  /*  minimum node box height                   */
export const ATTR_H = 30  /*  height of a single attribute line         */
export const ATTR_P = 8   /*  top padding of the attribute block        */
export const TYPE_H = 26  /*  extra height of the type line             */
export const TYPE_D = 36  /*  baseline distance of the type to the name */

/*  determine node box sizes from their textual content
    (boxes are scaled up in height by a per-node factor to
    give the edges more attachment room)  */
export const measureNodes = (
    nodes:   Node[],
    config:  Config,
    scaleOf: (node: Node) => number
): { boxW: Map<string, number>, boxH: Map<string, number>, contentH: Map<string, number> } => {
    const PAD_W = 18  /*  left/right node box text padding  */

    /*  the resulting node box dimensions  */
    const boxW     = new Map<string, number>()
    const boxH     = new Map<string, number>()
    const contentH = new Map<string, number>()

    /*  measure the text content of every node  */
    for (const node of nodes) {
        const attrs = attrsOfNode(node)
        const type  = typeOf(node)
        let w = textWidth(node.name, FS_NAME)
        if (type !== undefined)
            w = Math.max(w, textWidth(type, FS_TYPE))
        for (const attr of attrs)
            w = Math.max(w, textWidth(`${attr.key}: ${attr.val}`, FS_ATTR))
        const h = MIN_H + (type !== undefined ? TYPE_H : 0) +
            (attrs.length > 0 ? attrs.length * ATTR_H + ATTR_P : 0)
        boxW.set(node.id, Math.max(config["size-node-width-min"], Math.ceil(w) + PAD_W * 2))
        boxH.set(node.id, Math.ceil(h * scaleOf(node)))
        contentH.set(node.id, h)
    }
    return { boxW, boxH, contentH }
}

