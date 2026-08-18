#!/usr/bin/env node
/*!
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  built-in dependencies  */
import fs                  from "node:fs"
import process             from "node:process"
import { fileURLToPath }   from "node:url"

/*  external dependencies  */
import { Command, Option } from "commander"

/*  internal dependencies  */
import { Config, configDefaults }                                       from "./gradia-api-config.js"
import { renderDiagram, DiagramType, diagramTypes, diagramTypeDefault } from "./gradia-api.js"

/*  internal package meta-information  */
const pkg = JSON.parse(fs.readFileSync(
    fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as
    { version: string, description: string }

/*  the parsed command-line options ("output" is required and "type"
    is defaulted, so both are guaranteed to be present strings)  */
interface CLIOptions {
    output: string
    type:   DiagramType
    [key: string]: string | boolean | undefined
}

/*  establish the command-line interface  */
const program = new Command()
program.name("gradia")
    .description(pkg.description)
    .version(pkg.version)
    .requiredOption("-o, --output <file>",         "output SVG file")
    .addOption(new Option("-t, --type <type>",     "diagram type")
        .choices(diagramTypes).default(diagramTypeDefault))
    .option("--font-family <family>",              "font family name or path to a WOFF2 file")
    .option("--font-embed",                        "embed the WOFF2 font file into the SVG")
    .option("--color-node-regular-name <color>",   "text color of regular nodes")
    .option("--color-node-regular-box <color>",    "box color of regular nodes")
    .option("--color-node-regular-border <color>", "border color of regular nodes")
    .option("--color-node-primary-name <color>",   "text color of primary nodes")
    .option("--color-node-primary-box <color>",    "box color of primary nodes")
    .option("--color-node-primary-border <color>", "border color of primary nodes")
    .option("--color-node-ghost-name <color>",     "text color of ghost nodes")
    .option("--color-node-ghost-box <color>",      "box color of ghost nodes")
    .option("--color-node-ghost-border <color>",   "border color of ghost nodes")
    .option("--color-group-name <color>",          "tag color of group boxes")
    .option("--color-group-box <color>",           "box color of group boxes")
    .option("--color-group-border <color>",        "border color of group boxes")
    .option("--color-edge-line <color>",           "line color of edges")
    .option("--color-edge-name <color>",           "name label color of edges")
    .option("--color-edge-arity <color>",          "arity label color of edges")
    .argument("<input>", "input graph description file")
    .action(async (input: string, options: CLIOptions) => {
        /*  pass through the explicitly given rendering configuration options  */
        const config: Partial<Config> = {}
        for (const key of Object.keys(configDefaults) as (keyof Config)[]) {
            const val = options[key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())]
            if (val !== undefined)
                (config as Record<string, string | boolean>)[key] = val
        }

        /*  read the input, render the diagram, and write the output  */
        const text = fs.readFileSync(input, "utf8")
        const svg  = await renderDiagram(text, { type: options.type, config })
        fs.writeFileSync(options.output, svg, "utf8")
    })

/*  run the command-line interface  */
program.parseAsync().catch((err: unknown) => {
    process.stderr.write(`gradia: ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
})

