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

/*  re-export the graph model and configuration companion types  */
export type { Attr, Node, Edge, Graph }            from "./gradia-api-model.js"
export type { Config }                             from "./gradia-api-config.js"

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

/*  the Gradia API facade  */
export class Gradia {
    /*  parse a graph description into the graph model  */
    static parse (spec: string): Graph {
        return parse(spec)
    }

    /*  generate an SVG document or data URL from a graph model
        (the rendering configuration is layered: defaults, then the
        explicit config options)  */
    static async generate (graph: Graph, options: DiagramOptions = {}): Promise<string> {
        /*  determine and validate the diagram type and output format  */
        const type   = options.type ?? diagramTypeDefault
        if (!Object.hasOwn(renderers, type))
            throw new Error(`invalid diagram type "${type}"`)
        const format = options.format ?? diagramFormatDefault
        if (!diagramFormats.includes(format))
            throw new Error(`invalid output format "${format}"`)

        /*  layer the rendering configuration  */
        const config = { ...configDefaults, ...(options.config ?? {}) }

        /*  lay out the graph model: either as a whole, or partitioned
            into its named groups which are laid out individually and
            then stacked vertically as decorated group boxes  */
        const parts  = partitionGroups(graph)
        const layout = parts === null ?
            await renderers[type](graph, config) :
            composeGroups(parts, await Promise.all(
                parts.map((part) => renderers[type](part.graph, config))), config)

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

    /*  render a graph description into an SVG document or data URL
        (combines parse and generate, with the "#config <option> <value>"
        directives from the spec layered between the defaults and the
        explicit config options)  */
    static async render (spec: string, options: DiagramOptions = {}): Promise<string> {
        const graph  = Gradia.parse(spec)
        const config = { ...parseDirectives(spec), ...(options.config ?? {}) }
        return Gradia.generate(graph, { ...options, config })
    }
}

