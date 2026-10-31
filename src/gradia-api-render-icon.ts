/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { NodeStyle, Styler, escapeXML }                     from "./gradia-api-render-base.js"
import { type NodeBadge }                                   from "./gradia-api-render-node.js"

/*  the badge radius the icons are drawn for  */
const ICON_R = 17

/*  the path of a circle (as one of several subpaths of an icon)  */
const circlePath = (cx: number, cy: number, r: number): string =>
    `M ${cx + r} ${cy} a ${r} ${r} 0 1 0 ${-2 * r} 0 a ${r} ${r} 0 1 0 ${2 * r} 0`

/*  the path of a cloud: bulges all around, as arcs between points on an ellipse  */
const cloudPath = (): string => {
    const n  = 7
    const pt = (k: number) => {
        const t = Math.PI * 2 * k / n - Math.PI / 2
        return [ Math.round(8.5 * Math.cos(t) * 100) / 100, Math.round(5.5 * Math.sin(t) * 100) / 100 ]
    }
    let d = `M ${pt(0)[0]} ${pt(0)[1]}`
    for (let k = 1; k <= n; k++) {
        const [ px, py ] = pt(k - 1)
        const [ qx, qy ] = pt(k)
        const r = Math.round(Math.hypot(qx - px, qy - py) * 58) / 100
        d += ` A ${r} ${r} 0 0 1 ${qx} ${qy}`
    }
    return `${d} z`
}

/*  the path of a gear: a ring with eight teeth around a hub  */
const gearPath = (): string =>
    Array.from({ length: 8 }, (_, k) => {
        const [ c, s ] = [ Math.cos(k * Math.PI / 4), Math.sin(k * Math.PI / 4) ]
        return `M ${Math.round(5.5 * c * 100) / 100} ${Math.round(5.5 * s * 100) / 100} ` +
            `L ${Math.round(8 * c * 100) / 100} ${Math.round(8 * s * 100) / 100}`
    }).join(" ") + ` ${circlePath(0, 0, 5.5)} ${circlePath(0, 0, 1.5)}`

/*  the icons of the badges, drawn around the origin for a badge radius
    of ICON_R: the stroked line path, its optional thinner stroke, and
    the optional filled dots (center and radius)  */
const badgeIcons: Record<NodeBadge, { d: string, thin?: boolean, dots?: [ number, number, number ][] }> = {
    person:   { d: `${circlePath(0, -7, 3.5)} M -7 8 q 0 -8 7 -8 q 7 0 7 8` },
    team:     { d: `${circlePath(-2.5, -4, 3)} M -8.5 8 q 0 -7 6 -7 q 6 0 6 7 ` +
        `${circlePath(4.5, -6.5, 2.5)} M 4 -1.5 q 4.5 0 4.5 5` },
    bot:      { d: "M -7 -3.5 h 14 v 10.5 h -14 z M 0 -3.5 v -3",
        dots: [ [ 0, -7.5, 1.8 ], [ -3, 1.5, 1.6 ], [ 3, 1.5, 1.6 ] ] },
    device:   { d: "M -7 -7 h 14 v 10 h -14 z M -4 7 h 8 M 0 3 v 4" },
    mobile:   { d: "M -2.5 -8.5 h 5 q 2 0 2 2 v 13 q 0 2 -2 2 h -5 q -2 0 -2 -2 v -13 q 0 -2 2 -2 z M -1.5 5 h 3" },
    browser:  { d: "M -8 -6.5 h 16 v 13 h -16 z M -8 -2.5 h 16" },
    service:  { d: gearPath() },
    function: { d: "M -5.5 -8 h 2.5 l 7.5 16 h 2 M 0.75 0 l -5.5 8" },
    api:      { d: "M -9 0 h 5 M -2.5 -7 a 7 7 0 0 1 0 14 M 4.5 0 h 4.5", thin: true,
        dots: [ [ -2.5, 0, 3.5 ] ] },
    code:     { d: "M -4 -5 l -4 5 l 4 5 M 4 -5 l 4 5 l -4 5 M 1.5 -7.5 l -3 15" },
    package:  { d: "M 0 -8.5 l 7.5 4 v 9 l -7.5 4 l -7.5 -4 v -9 z M -7.5 -4.5 l 7.5 4 l 7.5 -4 M 0 -0.5 v 9" },
    database: { d: "M -7 -5 a 7 2.5 0 0 1 14 0 v 10 a 7 2.5 0 0 1 -14 0 z M -7 -5 a 7 2.5 0 0 0 14 0" },
    cache:    { d: "M 1.5 -8.5 l -6.5 10 h 5 l -1.5 7 l 6.5 -10 h -5 z" },
    queue:    { d: "M -5 -6 h 10 a 3 6 0 0 1 0 12 h -10 a 3 6 0 0 1 0 -12 z M 5 -6 a 3 6 0 0 0 0 12" },
    document: { d: "M -5.5 -8 h 7 l 4.5 4.5 v 11.5 h -11.5 z M 1.5 -8 v 4.5 h 4.5 M -3 1 h 6 M -3 4.5 h 6" },
    mail:     { d: "M -8 -5.5 h 16 v 11 h -16 z M -8 -5.5 l 8 6 l 8 -6" },
    communication: { d: "M -7 -3.5 h 13 M 3 -6.5 l 3.5 3 l -3.5 3 M 7 3.5 h -13 M -3 0.5 l -3.5 3 l 3.5 3" },
    clock:    { d: `${circlePath(0, 0, 7.5)} M 0 -4.5 v 4.5 h 3.5` },
    security: { d: "M 0 -8.5 l 7 2.5 v 4 c 0 5 -3 8.5 -7 10.5 c -4 -2 -7 -5.5 -7 -10.5 v -4 z " +
        "M -3 0 l 2 2.5 l 4 -4.5" },
    cloud:    { d: cloudPath() },
    network:  { d: "M 0 -5.5 L -6.5 5 L 6.5 5 z", thin: true,
        dots: [ [ 0, -5.5, 3 ], [ -6.5, 5, 3 ], [ 6.5, 5, 3 ] ] }
}

/*  generate the SVG fragments of the icon of a badge, around the badge
    center as the origin, taking the text color, as the border color is
    too faint  */
const renderIcon = (badge: NodeBadge, style: NodeStyle, styler: Styler): string[] => {
    const icon = badgeIcons[badge]
    const fill = styler.box(style.text, style.text, 1)
    return [ `<path d="${icon.d}" class="${styler.line(style.text, icon.thin === true ? 2 : 2.5)}"/>`,
        ...(icon.dots ?? []).map(([ cx, cy, r ]) => `<circle cx="${cx}" cy="${cy}" r="${r}" class="${fill}"/>`) ]
}

/*  generate the SVG fragments of a badge of the given radius centered on
    the given point, in the colors of a node box, but with a thinner border,
    as it sits inside the box (the icons are drawn for a badge radius of
    ICON_R, so they scale with the badge to keep their room around them)  */
export const renderBadge = (badge: NodeBadge, bx: number, by: number, r: number, style: NodeStyle,
    styler: Styler): string[] => {
    const cls  = styler.box(style.fill, style.stroke, 2)
    const dash = style.dash !== undefined ? ` stroke-dasharray="${escapeXML(style.dash)}"` : ""
    return [ `<circle cx="${bx}" cy="${by}" r="${r}" class="${cls}"${dash}/>`,
        `<g transform="translate(${bx} ${by}) scale(${Math.round(r / ICON_R * 1000) / 1000})">`,
        ...renderIcon(badge, style, styler), "</g>" ]
}

