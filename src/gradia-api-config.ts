/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  built-in dependencies  */
import fs   from "node:fs"
import path from "node:path"

/*  the rendering configuration and its default values  */
export const configDefaults = {
    "font-family":               "Helvetica",
    "font-embed":                false,
    "color-node-regular-name":   "#336699",
    "color-node-regular-box":    "#e0f0ff",
    "color-node-regular-border": "#c0d0e0",
    "color-node-primary-name":   "#ffffff",
    "color-node-primary-box":    "#336699",
    "color-node-primary-border": "#003366",
    "color-node-ghost-name":     "#666666",
    "color-node-ghost-box":      "#f0f0f0",
    "color-node-ghost-border":   "#a0a0a0",
    "color-group-name":          "#6699cc",
    "color-group-box":           "#f4f8fc",
    "color-group-border":        "#c0d0e0",
    "color-edge-line":           "#999999",
    "color-edge-name":           "#333333",
    "color-edge-arity":          "#333333",
    "size-canvas-margin":        40,    /*  outer margin of the canvas             */
    "size-node-width-min":       220,   /*  minimum node box width                 */
    "size-node-height-scale":    2.25,  /*  height scale of node boxes             */
    "size-edge-corner-radius":   20,    /*  corner rounding radius of edges        */
    "size-edge-hop-radius":      8,     /*  radius of edge crossing hops           */
    "size-edge-track-gap":       12,    /*  offset between parallel edge routes    */
    "group-box-padding":         30,    /*  inner padding of group boxes           */
    "group-box-gap":             40,    /*  vertical gap between group boxes       */
    "graph-columns-max":         5,     /*  graph: max side-by-side nodes          */
    "graph-channel-width-max":   140,   /*  graph: max width of column channels    */
    "graph-gutter-height-max":   90,    /*  graph: max height of row gutters       */
    "graph-node-separation":     30,    /*  graph: layered layout node separation  */
    "graph-rank-separation":     60,    /*  graph: layered layout rank separation  */
    "hub-channel-width-max":     340,   /*  hub: max width of column channels      */
    "hub-channel-width-min":     240,   /*  hub: min width of column channels      */
    "hub-node-gap":              20,    /*  hub: vertical gap of stacked nodes     */
    "grid-columns-max":          4,     /*  grid: max side-by-side tiles           */
    "grid-gap-horizontal":       40,    /*  grid: horizontal gap between tiles     */
    "grid-gap-vertical":         20     /*  grid: vertical gap between tiles       */
}
export type Config = typeof configDefaults

/*  the configuration options which are directly embedded into the
    generated SVG (and hence can alternatively be provided at display
    time through "--gradia-<option>" CSS custom properties)  */
export type ConfigEmbedded = { [K in keyof Config]: Config[K] extends string ? K : never }[keyof Config]

/*  resolve a directly embedded configuration option into a CSS value:
    an explicitly configured value is hard-coded (stripped of the
    characters which would end the CSS declaration, to prevent a CSS
    injection from untrusted values), while otherwise the value is
    fetched at display time from the CSS custom property
    "--gradia-<option>", falling back to the built-in default  */
export const cssValueOf = (explicit: Partial<Config>, key: ConfigEmbedded): string =>
    Object.hasOwn(explicit, key) ?
        explicit[key]!.replace(/[;{}]/g, "") :
        `var(--gradia-${key}, ${configDefaults[key]})`

/*  parse "#config <option> <value>" configuration directives from a graph
    description (lines which are otherwise treated as plain comments)  */
export const parseDirectives = (input: string): Partial<Config> => {
    const partial: Record<string, string | boolean | number> = {}
    for (const line of input.split(/\r?\n/)) {
        const m = /^[ \t]*#config[ \t]+([a-z][a-z0-9-]*)[ \t]+(?:"((?:[^"\\]|\\.)*)"|(\S+))[ \t]*$/.exec(line)
        if (m === null || !Object.hasOwn(configDefaults, m[1]))
            continue
        const key = m[1] as keyof Config
        const val = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3]

        /*  reject font file paths and font embedding from the untrusted graph
            description, as they would let it read arbitrary local WOFF2 files  */
        if (key === "font-embed" || (key === "font-family" && val.endsWith(".woff2")))
            continue
        if (typeof configDefaults[key] === "boolean")
            partial[key] = val === "true"
        else if (typeof configDefaults[key] === "number") {
            /*  silently skip invalid numeric values, as directives are
                lines of an untrusted input and never abort the rendering  */
            const num = Number(val)
            if (val === "" || !Number.isFinite(num) || num < 0)
                continue
            partial[key] = num
        }
        else
            partial[key] = val
    }
    return partial as Partial<Config>
}

/*  resolve the configured font family: either a plain family name or a
    path to a WOFF2 file (its content optionally embedded as base64)  */
export const resolveFont = (config: Config): { family: string, embed?: string } => {
    const spec = config["font-family"]
    if (spec.endsWith(".woff2")) {
        const family = path.basename(spec, ".woff2")
        if (config["font-embed"])
            return { family, embed: fs.readFileSync(spec).toString("base64") }
        else
            return { family }
    }
    else if (config["font-embed"])
        throw new Error("option \"font-embed\" requires option \"font-family\" to be the path to a WOFF2 file")
    else
        return { family: spec }
}

