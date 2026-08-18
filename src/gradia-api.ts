/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Graph }                                   from "./gradia-api-model.js"
import { parse }                                   from "./gradia-api-parser.js"
import { Config, configDefaults, parseDirectives } from "./gradia-api-config.js"
import { partitionGroups, composeGroups }          from "./gradia-api-render-group.js"
import { Layout, renderSVG }                       from "./gradia-api-render-svg.js"
import { render as renderGraph }                   from "./gradia-api-type-graph.js"
import { render as renderHub }                     from "./gradia-api-type-hub.js"
import { render as renderGrid }                    from "./gradia-api-type-grid.js"

/*  the supported diagram types and their renderers  */
const renderers = {
    graph: renderGraph,
    hub:   renderHub,
    grid:  renderGrid
} satisfies Record<string, (graph: Graph, config: Config) => Promise<Layout>>
export type DiagramType = keyof typeof renderers
export const diagramTypes = Object.keys(renderers) as DiagramType[]
export const diagramTypeDefault: DiagramType = "graph"

/*  the supported output formats  */
export const diagramFormats = [ "svg:standalone", "svg:embedded", "url:xml", "url:base64" ] as const
export type DiagramFormat = typeof diagramFormats[number]
export const diagramFormatDefault: DiagramFormat = "svg:standalone"

/*  the diagram rendering options  */
export interface DiagramOptions {
    type?:   DiagramType
    format?: DiagramFormat
    config?: Partial<Config>
}

/*  the diagram rendering API: render a graph description into an SVG
    document or data URL (the rendering configuration is layered:
    defaults, then "#<option> <value>" directives from the input, then
    the explicit config options)  */
export const renderDiagram = async (input: string, options: DiagramOptions = {}): Promise<string> => {
    /*  determine and validate the diagram type and output format  */
    const type   = options.type ?? diagramTypeDefault
    if (!Object.hasOwn(renderers, type))
        throw new Error(`invalid diagram type "${type}"`)
    const format = options.format ?? diagramFormatDefault
    if (!diagramFormats.includes(format))
        throw new Error(`invalid output format "${format as string}"`)

    /*  layer the rendering configuration and parse the graph description  */
    const config = { ...configDefaults, ...parseDirectives(input), ...(options.config ?? {}) }
    const graph  = parse(input)

    /*  lay out the graph model: either as a whole, or partitioned
        into its named groups which are laid out individually and
        then stacked vertically as decorated group boxes  */
    const parts  = partitionGroups(graph)
    const layout = parts === null ?
        await renderers[type](graph, config) :
        composeGroups(parts, await Promise.all(
            parts.map((part) => renderers[type](part.graph, config))))

    /*  render the laid out graph into an SVG document  */
    const svg = renderSVG(layout, config)

    /*  convert the SVG document into the requested output format  */
    if (format === "svg:embedded")
        return svg.replace(/^<\?xml[^?]*\?>\n/, "")
    else if (format === "url:xml")
        return `data:image/svg+xml,${encodeURIComponent(svg)}`
    else if (format === "url:base64")
        return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
    else
        return svg
}

