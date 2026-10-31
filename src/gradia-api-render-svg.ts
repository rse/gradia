/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  external dependencies  */
import UUID                                                 from "pure-uuid"

/*  internal dependencies  */
import { Config, ConfigEmbedded, resolveFont, cssValueOf, cssSizeOf }
    from "./gradia-api-config.js"
import { Poly, Layout, Box, Styler, escapeXML }             from "./gradia-api-render-base.js"
import { defaultStyleOf, markOf, markedStyleOf, isDormant, parentOf }
    from "./gradia-api-render-node.js"
import { computeHops, piecesOf, pathOf, junctionsOf }       from "./gradia-api-render-path.js"
import { labelPlacer, arityBoxes, renderEdgeArity, stubLabels, arrivalLabels, portLabels, renderEdgeName,
    nameText }
    from "./gradia-api-render-label.js"
import { renderNode, renderGroup, renderContainer, renderShape }
    from "./gradia-api-render-element.js"

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

/*  the radius of the dot marking a junction of bundled edges (clearly
    wider than an edge line, but far below an arrow head)  */
const JUNCTION_R = 5

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

/*  generate the SVG fragments of an arrow head marker  */
const marker = (id: string, cls: string): string[] => [
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" ` +
        "markerWidth=\"21\" markerHeight=\"21\" markerUnits=\"userSpaceOnUse\" " +
        "orient=\"auto-start-reverse\">",
    `<path d="M 0 1 L 9 5 L 0 9 z" class="${cls}"/>`,
    "</marker>"
]

/*  generate the SVG fragments of a disc marker (e.g. of an inhibitor
    arc), whose far side sits on the end of its edge  */
const discMarker = (id: string, cls: string): string[] => [
    `<marker id="${id}" viewBox="0 0 10 10" refX="9.4" refY="5" ` +
        "markerWidth=\"15\" markerHeight=\"15\" markerUnits=\"userSpaceOnUse\" orient=\"auto\">",
    `<circle cx="5" cy="5" r="4.2" class="${cls}"/>`,
    "</marker>"
]

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
    const idArrow     = `${prefix}-arrow`
    const idOpen      = `${prefix}-arrow-open`
    const idAlert     = `${prefix}-alert`
    const idDisc      = `${prefix}-disc`
    const idDiscAlert = `${prefix}-disc-alert`

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
            (options.end    ? "text-anchor: end; "    : "") +
            `fill: ${color(fill)}` +
            (options.halo ? `; stroke: ${color("color-edge-halo")}; stroke-width: 4.5; ` +
                "paint-order: stroke; stroke-linejoin: round" : "")),
        box: (fill, stroke, width) => classOf(
            `fill: ${color(fill)}; stroke: ${color(stroke)}; stroke-width: ${width}`),
        line: (stroke, width) => classOf(
            `fill: none; stroke: ${color(stroke)}; stroke-width: ${width}; stroke-linecap: round; stroke-linejoin: round`)
    }
    const classEdge  = classOf(`fill: none; stroke: ${color("color-edge-line")}; stroke-width: 3`)
    const classArrow = classOf(`fill: ${color("color-edge-line")}`)

    /*  an edge marked as a violation (by its layout, by itself, or as
        leaving an unreachable or dead node or container, a two-way edge
        at either end) is drawn dashed in the violation color, its arrow
        head and labels alike  */
    const marks      = new Map([ ...nodes, ...containers.map((c) => c.node) ].map((node) => [ node.id, markOf(node) ]))
    const violates   = (i: number): boolean => layout.marked?.[i] === true
        || (config["mark-violation"] && (edges[i].marked === true || isDormant(marks.get(edges[i].source))
            || (layout.twoway?.[i] === true && isDormant(marks.get(edges[i].target)))))
    const alerted    = edges.some((_, i) => violates(i))
    const classAlert = alerted ? classOf(`fill: none; stroke: ${color("color-mark-violation")}; stroke-width: 3; ` +
        "stroke-dasharray: 10 6") : ""
    const classAlertArrow = alerted ? classOf(`fill: ${color("color-mark-violation")}`) : ""

    /*  detect the edge crossings requiring rendered hops  */
    const hops = computeHops(polys)

    /*  prepare the collision-free placement of the edge labels  */
    const { claim, seize, reserve, occupied } = labelPlacer(layout, hops, config["size-edge-hop-radius"], config)

    /*  generate the SVG fragments for the edge paths (sharply turning
        at the junctions of bundled edges) and the dots marking those
        junctions on top of them, where only the first edge of a group
        merged into one port draws the arrow head and the arity there, and
        the segments shared by bundled edges are drawn once (see "piecesOf")  */
    const junctions  = junctionsOf(polys, (i) => layout.bundled?.[i] === true)
    const junctionAt = new Set(junctions.map(([ x, y ]) => `${x}:${y}`))
    const junction   = junctionAt.size > 0 ? (x: number, y: number) => junctionAt.has(`${x}:${y}`) : undefined
    const groupsAt = (end: (poly: Poly) => [ number, number ]): Map<number, number[]> => {
        const byPort = new Map<string, number[]>()
        polys.forEach((poly, i) => {
            if (layout.bundled?.[i] === true)
                byPort.set(`${end(poly)}`, [ ...byPort.get(`${end(poly)}`) ?? [], i ])
        })
        return new Map(Array.from(byPort.values()).filter((l) => l.length > 1).map((l) => [ l[0], l ]))
    }
    const into    = groupsAt((poly) => poly[poly.length - 1])
    const outOf   = groupsAt((poly) => poly[0])
    const grouped = new Set([ ...into.values(), ...outOf.values() ].flat())
    const repeat  = new Set(Array.from(into.values()).flatMap((l) => l.slice(1)))

    /*  a return or create edge, and an edge flagged by its layout, is
        drawn dashed, an asynchronous, return, or create edge ends in an
        open arrow head, an outlined triangle filled with the halo color,
        so it covers the line ending at its tip, an inhibitor edge ends in
        an outlined disc instead, and a two-way edge starts with an arrow
        head, too (its markers and classes are defined only on demand, so
        diagrams without such edges stay unchanged)  */
    const kindOf    = (i: number) => edges[i].kind ?? "sync"
    const dashKind  = (i: number) => kindOf(i) === "return" || kindOf(i) === "create"
    const dashed    = (i: number) => dashKind(i) || layout.dashed?.[i] === true
    const hollow    = (i: number) => dashKind(i) || kindOf(i) === "async"
    const disc      = (i: number) => kindOf(i) === "inhibitor"
    const open      = polys.some((_, i) => hollow(i))
    const classOpen = open ? classOf(`fill: ${color("color-edge-halo")}; stroke: ${color("color-edge-line")}; ` +
        "stroke-width: 1.2; stroke-linejoin: round") : ""
    const classDash = polys.some((_, i) => dashed(i)) ?
        classOf(`fill: none; stroke: ${color("color-edge-line")}; stroke-width: 3; stroke-dasharray: 10 6`) : ""

    /*  the classes of the disc markers of the inhibitor edges (regular
        and marked as a violation)  */
    const discs          = polys.some((_, i) => disc(i))
    const classDisc      = discs ? classOf(`fill: ${color("color-edge-halo")}; ` +
        `stroke: ${color("color-edge-line")}; stroke-width: 1.6`) : ""
    const classDiscAlert = discs && alerted ? classOf(`fill: ${color("color-edge-halo")}; ` +
        `stroke: ${color("color-mark-violation")}; stroke-width: 1.6`) : ""
    const head      = (i: number) => violates(i) ? (disc(i) ? idDiscAlert : idAlert) :
        disc(i) ? idDisc : hollow(i) ? idOpen : idArrow
    const svgEdges = piecesOf(polys, layout.bundled).flatMap((pieces, i) => pieces.map((piece) =>
        `<path d="${pathOf(polys[i], hops[i], config["size-edge-corner-radius"], config["size-edge-hop-radius"],
            junction, layout.crowded === true, piece)}" ` +
        `class="${violates(i) ? classAlert : dashed(i) ? classDash : classEdge}"` +
        (layout.twoway?.[i] === true && piece.from === 0 ?
            ` marker-start="url(#${violates(i) ? idAlert : idArrow})"` : "") +
        (repeat.has(i) || !piece.end ? "/>" : ` marker-end="url(#${head(i)})"/>`)))
    const passes = (poly: Poly, x: number, y: number): boolean =>
        poly.some((p, m) => m > 0
            && Math.min(p[0], poly[m - 1][0]) <= x && x <= Math.max(p[0], poly[m - 1][0])
            && Math.min(p[1], poly[m - 1][1]) <= y && y <= Math.max(p[1], poly[m - 1][1]))
    const svgJunctions = junctions.map(([ x, y ]) => {
        /*  a junction of a bundle of marked edges takes their color, as a
            bundle never mixes marked and unmarked edges  */
        const marked = alerted && polys.some((poly, i) => violates(i) && passes(poly, x, y))
        return `<circle cx="${x}" cy="${y}" r="${JUNCTION_R}" class="${marked ? classAlertArrow : classArrow}"/>`
    })

    /*  reserve the position every arity label prefers -- the one beside
        its own arrow head -- before any name label is placed, as an
        arity is bound to that arrow while a name may slide along the
        whole route: a name hence yields the reserved area wherever it
        has an alternative, and only a name left without one takes it
        and pushes its arity onto the next setback  */
    const arities = edges.map((edge, i) =>
        edge.arity !== undefined && !repeat.has(i) ? arityBoxes(edge.arity, polys[i], config) : undefined)
    for (const candidates of arities)
        if (candidates !== undefined)
            reserve(candidates[0])

    /*  generate the SVG fragments for the edge labels (the names
        first, as their reservations keep the arity positions free),
        where every unbundled name first takes its anchor (see
        "arrivalLabels"), before any name searches a position of its own:
        all names an anchor crossed by no other line, the remaining ones an
        anchor crossed by a single line, and only a name without a free
        anchor searches along its route (the name of an edge leaving a
        choice or junction, i.e. its guard, is anchored at its start instead)  */
    const svgLabels: string[] = []
    const stubAt = stubLabels(layout, config)
    const placed = edges.map(() => false)
    const byId   = new Map(nodes.map((node) => [ node.id, node ]))
    const leads  = (i: number): boolean => {
        const node  = byId.get(edges[i].source)
        const shape = node !== undefined ? styleOf(node).shape : undefined
        return shape === "choice" || shape === "junction"
    }
    const clear = (i: number, box: Box): boolean =>
        polys[i].every((p, k) => k < 2
            || Math.max(p[0], polys[i][k - 1][0]) < box[0] || Math.min(p[0], polys[i][k - 1][0]) > box[2]
            || Math.max(p[1], polys[i][k - 1][1]) < box[1] || Math.min(p[1], polys[i][k - 1][1]) > box[3])
    for (const cross of [ 0, 1 ]) {
        edges.forEach((edge, i) => {
            if (placed[i] || layout.bundled?.[i] === true || layout.centered === true)
                return
            const lead   = leads(i)
            const anchor = (lead ? portLabels(edge, polys[i], false, config).filter((box) => clear(i, box)) :
                arrivalLabels(edge, polys[i], config)).find((box) => seize(box, i, cross))
            if (anchor === undefined)
                return
            svgLabels.push(...nameText(edge, anchor, styler, violates(i),
                anchor[2] <= polys[i][lead ? 0 : polys[i].length - 1][0] ? "end" : "start",
                layout.transitions === true))
            placed[i] = true
        })
    }
    edges.forEach((edge, i) => {
        if (placed[i])
            return
        const name = (preferred?: Box[], mates?: number[]) =>
            svgLabels.push(...renderEdgeName(edge, polys[i],
                (c, dodge) => claim(c, i, dodge, undefined, mates),
                styler, config, violates(i), preferred, layout.transitions === true))
        if (!grouped.has(i))
            name(stubAt.get(i))
        if (into.has(i))
            name(portLabels(edge, polys[i], true, config), into.get(i))
        if (outOf.has(i))
            name(portLabels(edge, polys[i], false, config), outOf.get(i))
    })
    edges.forEach((edge, i) => {
        const candidates = arities[i]
        if (candidates !== undefined)
            svgLabels.push(...renderEdgeArity(edge, candidates,
                (c, dodge, own) => claim(c, i, dodge, own), styler, violates(i)))
    })

    /*  generate the SVG fragments for the node boxes (with their marking,
        and grouped with their optional tooltip)  */
    const svgNodes = nodes.flatMap((node) => {
        const style = markedStyleOf(node, styleOf(node), config)
        const parts = renderNode(node, layout, style, styler, config)
        return style.title === undefined ? parts :
            [ "<g>", `<title>${escapeXML(style.title)}</title>`, ...parts, "</g>" ]
    })

    /*  generate the SVG fragments for the group boxes (drawn below
        everything else) and the container boxes (drawn below the edges
        and nodes, an outer box before its nested ones)  */
    const svgGroups     = groups.flatMap((group) => renderGroup(group, styler))
    const svgContainers = containers.flatMap((c) => renderContainer(c, styler, config,
        containers.find((o) => o.node.id === parentOf(c.node))))

    /*  generate the SVG fragments for the free-standing shapes (drawn
        above the boxes and below the edges and nodes, in their order,
        except the texts, drawn above the nodes like the edge labels)  */
    const shapes    = layout.shapes ?? []
    const svgShapes = shapes.filter((shape) => shape.kind !== "text").map((shape) => renderShape(shape, styler))
    const svgTexts  = shapes.filter((shape) => shape.kind === "text").map((shape) => renderShape(shape, styler))

    /*  determine the overall bounding box of all rendered elements  */
    const groupBoxes: Box[] = groups.map((group) =>
        [ group.x, group.y, group.x + group.w, group.y + group.h ])
    const containerBoxes: Box[] = containers.map((c) =>
        [ c.x, c.y, c.x + c.w, c.y + c.h ])
    const vb = viewBoxOf(layout, [ ...occupied, ...groupBoxes, ...containerBoxes, ...shapes.map((shape) => shape.box) ],
        config["size-canvas-margin"])

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
        ...marker(idArrow, classArrow),
        ...(alerted ? marker(idAlert, classAlertArrow) : []),
        ...(open ? [
            `<marker id="${idOpen}" viewBox="0 0 10 10" refX="9" refY="5" ` +
                "markerWidth=\"21\" markerHeight=\"21\" markerUnits=\"userSpaceOnUse\" " +
                "orient=\"auto-start-reverse\">",
            `<path d="M 0.6 1 L 9 5 L 0.6 9 z" class="${classOpen}"/>`,
            "</marker>"
        ] : []),
        ...(discs ? discMarker(idDisc, classDisc) : []),
        ...(discs && alerted ? discMarker(idDiscAlert, classDiscAlert) : []),
        "</defs>",
        ...svgGroups,
        ...svgContainers,
        ...svgShapes,
        ...svgEdges,
        ...svgJunctions,
        ...svgNodes,
        ...svgTexts,
        ...svgLabels,
        "</svg>",
        ""
    ].join("\n")
}

