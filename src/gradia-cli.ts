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
import { validateConfig }                                               from "./gradia-api-config.js"
import { Gradia, DiagramType, diagramTypes, diagramTypeDefault,
    DiagramFormat, diagramFormats, diagramFormatDefault }               from "./gradia-api.js"

/*  internal package meta-information  */
const pkg = JSON.parse(fs.readFileSync(
    fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as
    { version: string, description: string }

/*  the parsed command-line options ("format" and "config" are
    defaulted, while "type" is intentionally left undefined if not
    given, to let a "#type" directive of the input take effect, and
    "output" is required in the regular rendering mode only)  */
interface CLIOptions {
    output?: string
    type?:   DiagramType
    format:  DiagramFormat
    config:  string[]
    mcp:     boolean
}

/*  establish the command-line interface  */
const program = new Command()
program.name("gradia")
    .description(pkg.description)
    .version(pkg.version)
    .option("-o, --output <file>",                 "output SVG file")
    .option("-m, --mcp",                           "run as an MCP (Model Context Protocol) service on stdio", false)
    .addOption(new Option("-t, --type <type>",
        `diagram type (default: "#type" directive of input, else "${diagramTypeDefault}")`)
        .choices(diagramTypes))
    .addOption(new Option("-f, --format <format>", "output format")
        .choices(diagramFormats).default(diagramFormatDefault))
    .option("-c, --config <name>=<value>",         "rendering configuration option (repeatable)",
        (nv: string, prev: string[]) => prev.concat(nv), [] as string[])
    .argument("[input]", "input graph description file (omitted in MCP service mode)")
    .action(async (input: string | undefined, options: CLIOptions) => {
        /*  parse and validate the rendering configuration options  */
        const store: Record<string, string> = {}
        for (const nv of options.config) {
            const m = /^([a-z][a-z0-9-]*)=(.*)$/.exec(nv)
            if (m === null)
                throw new Error(`invalid configuration option "${nv}" (expected "<name>=<value>")`)
            store[m[1]] = m[2]
        }
        const config = validateConfig(store, { trusted: true })

        /*  optionally run as an MCP service instead of rendering once,
            with the command-line options acting as the defaults of the
            tool calls (and hence being the only trusted source of the
            "font-embed" option and WOFF2 font file paths)  */
        if (options.mcp) {
            if (input !== undefined)
                throw new Error("option \"--mcp\" cannot be combined with an input graph description file")
            if (options.output !== undefined)
                throw new Error("option \"--mcp\" cannot be combined with option \"--output\"")
            const { serve: serveMCP } = await import("./gradia-mcp.js")
            await serveMCP(pkg, { type: options.type, format: options.format, config })
            return
        }

        /*  read the input, render the diagram, and write the output  */
        if (input === undefined)
            throw new Error("required input graph description file argument missing")
        if (options.output === undefined)
            throw new Error("required option \"--output\" missing")
        const text = fs.readFileSync(input, "utf8")
        const out  = await Gradia.render(text, { type: options.type, format: options.format, config })
        fs.writeFileSync(options.output, out, "utf8")
    })

/*  run the command-line interface  */
program.parseAsync().catch((err: unknown) => {
    process.stderr.write(`gradia: ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
})

