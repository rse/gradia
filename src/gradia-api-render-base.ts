/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { ConfigEmbedded } from "./gradia-api-config.js"

/*  rendering font size constants (the further geometry is configurable,
    see the "size-*" and per-diagram-type options in the configuration)  */
export const FS_NAME  = 30   /*  font size of node names       */
export const FS_TYPE  = 16   /*  font size of node types       */
export const FS_ATTR  = 22   /*  font size of node attributes  */
export const FS_EDGE  = 16   /*  font size of edge labels      */
export const FS_ARITY = 16   /*  font size of edge arities     */
export const FS_GROUP = 24   /*  font size of group tags       */

/*  the setback of an edge arity label from the arrow head it annotates
    (shared by the SVG rendering and the graph channel sizing)  */
export const ARITY_OFF = 24

/*  estimate rendered text width (no canvas available under Node,
    factor tuned for the average glyph advance of Source Sans 3)  */
export const textWidth = (text: string, size: number): number =>
    text.length * size * 0.52

/*  greedily wrap a text into the lines fitting a maximum rendered width
    (a word exceeding the width on its own is kept unbroken, as breaking
    inside a word harms the readability more than an overlong box)  */
export const textWrap = (text: string, size: number, maxWidth: number): string[] => {
    const words = text.split(/\s+/).filter((word) => word !== "")
    if (maxWidth <= 0 || words.length <= 1 || textWidth(text, size) <= maxWidth)
        return [ text ]
    const lines: string[] = []
    let line = words[0]
    for (const word of words.slice(1)) {
        if (textWidth(`${line} ${word}`, size) > maxWidth) {
            lines.push(line)
            line = word
        }
        else
            line = `${line} ${word}`
    }
    lines.push(line)
    return lines
}

/*  escape a string for use in XML/SVG content (control characters are
    stripped, as XML forbids them even in their escaped form)  */
export const escapeXML = (text: string): string =>
    text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")

/*  an orthogonal edge polyline  */
export type Poly = [ number, number ][]

/*  the node box coloring (given as configuration option keys which
    are resolved into CSS color values at SVG generation time)  */
export interface NodeStyle {
    fill:   ConfigEmbedded
    stroke: ConfigEmbedded
    text:   ConfigEmbedded
    dash?:  string
}

