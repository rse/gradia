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
    "color-edge-arity":          "#333333"
}
export type Config = typeof configDefaults

/*  parse "#<option> <value>" configuration directives from a graph
    description (lines which are otherwise treated as plain comments)  */
export const parseDirectives = (input: string): Partial<Config> => {
    const partial: Record<string, string | boolean> = {}
    for (const line of input.split(/\r?\n/)) {
        const m = /^[ \t]*#([a-z][a-z0-9-]*)[ \t]+(?:"((?:[^"\\]|\\.)*)"|(\S+))[ \t]*$/.exec(line)
        if (m === null || !Object.hasOwn(configDefaults, m[1]))
            continue
        const key = m[1] as keyof Config
        const val = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3]

        /*  reject font file paths and font embedding from the untrusted graph
            description, as they would let it read arbitrary local WOFF2 files  */
        if (key === "font-embed" || (key === "font-family" && val.endsWith(".woff2")))
            continue
        partial[key] = typeof configDefaults[key] === "boolean" ?
            val === "true" : val
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

