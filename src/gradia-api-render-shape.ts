/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { ConfigEmbedded } from "./gradia-api-config.js"

/*  a rectangular area, given by its top-left and bottom-right corners  */
type Area = [ number, number, number, number ]

/*  a free-standing drawing primitive of a diagram type beside its node
    boxes and edges (e.g. the lifelines of a "sequence" diagram), styled
    through the regular configuration options (a "path" starts at its
    origin with relative commands only, so it can be shifted, and carries
    the area it covers)  */
export interface ShapePath {
    kind:     "path"
    x:        number
    y:        number
    d:        string
    box:      Area
    stroke:   ConfigEmbedded
    width:    number
    dash?:    string
}
export type Shape = ShapePath

/*  create a path shape, its covered area given relative to its origin,
    exactly like its relative drawing commands  */
export const pathShape = (x: number, y: number, d: string, [ x1, y1, x2, y2 ]: Area,
    stroke: ConfigEmbedded, width: number, dash?: string): ShapePath =>
    ({ kind: "path", x, y, d, box: [ x + x1, y + y1, x + x2, y + y2 ], stroke, width, dash })

/*  shift a shape by an offset (e.g. into its group box)  */
export const shiftShape = (shape: Shape, dx: number, dy: number): Shape =>
    ({ ...shape, x: shape.x + dx, y: shape.y + dy,
        box: [ shape.box[0] + dx, shape.box[1] + dy, shape.box[2] + dx, shape.box[3] + dy ] })
