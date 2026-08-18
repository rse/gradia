/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  rendering geometry constants  */
export const FS_NAME  = 30   /*  font size of node names          */
export const FS_TYPE  = 16   /*  font size of node types          */
export const FS_ATTR  = 22   /*  font size of node attributes     */
export const FS_EDGE  = 16   /*  font size of edge labels         */
export const FS_ARITY = 16   /*  font size of edge arities        */
export const FS_GROUP = 24   /*  font size of group tags          */
export const MARGIN   = 40   /*  outer margin of the canvas       */
export const SLOT     = 12   /*  offset between parallel routes   */
export const RADIUS   = 20   /*  corner rounding radius of edges  */
export const HOP      = 8    /*  radius of edge crossing hops     */
export const SCALE_H  = 2.25 /*  height scale of node boxes       */

/*  estimate rendered text width (no canvas available under Node,
    factor tuned for the average glyph advance of Source Sans 3)  */
export const textWidth = (text: string, size: number): number =>
    text.length * size * 0.52

/*  escape a string for use in XML/SVG content  */
export const escapeXML = (text: string): string =>
    text.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")

/*  an orthogonal edge polyline  */
export type Poly = [ number, number ][]

/*  the node box coloring  */
export interface NodeStyle {
    fill:   string
    stroke: string
    text:   string
    dash?:  string
}

