/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  external dependencies  */
import { McpServer }            from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z }                    from "zod"

/*  internal dependencies  */
import { Config, configDefaults }                       from "./gradia-api-config.js"
import { Gradia, DiagramType, diagramTypes,
    DiagramFormat, diagramFormats, diagramFormatDefault } from "./gradia-api.js"

/*  the rendering configuration options offered to the MCP client
    ("font-embed" is intentionally omitted, as the arguments of a tool
    call are treated as untrusted and it would allow the reading of
    arbitrary local WOFF2 files)  */
const configOptions = Object.entries(configDefaults)
    .filter(([ key ]) => key !== "font-embed")
    .map(([ key, val ]) => `  - "${key}" (${typeof val}, default: ${JSON.stringify(val)})`)
    .join("\n")

/*  the comprehensive description of the "gradia_render" tool, teaching
    the AI the complete input language and the available parameters  */
const toolDescription = `
Render a directed object graph, described in the concise textual Gradia input
language, into an SVG diagram. Use this to visualize object graphs, class and
component relationships, data flows, dependency graphs, and similar structures.

## Diagram Types

- "graph": a loosely grid-snapped layered layout of the whole graph. This is
  the general-purpose type and the built-in default.
- "hub": a hub graph, placing the single primary node (the node carrying the
  attribute "primary: true") in the center, its input nodes to the left and
  its output nodes to the right.
- "grid": a compact grid of tiles for an edge-less graph.

## Input Language

The "input" argument is a plain-text graph description: one node/edge chain per
line, plus optional comments and rendering directives.

### Grammar

The following BNF grammar describes the input syntax. Non-terminals are written
as <name>, terminals as "...", optional parts as [ ... ], repeatable parts as
{ ... } (zero or more times), and alternatives are separated by |.

    <graph>          ::= { <statement> | <newline> }
    <statement>      ::= <node> { <edge> <node> } ( <newline> | <eof> )
    <node>           ::= <atom> [ ":" <atom> ] [ <attributes> ]
    <attributes>     ::= "[" <attribute> { "," <attribute> } "]"
    <attribute>      ::= <atom> ":" <atom>
    <edge>           ::= "--" [ "(" <edge-name> ")" "--" ] ">" [ "[" <edge-arity> "]" ]
    <edge-name>      ::= <string> | <name-word>
    <edge-arity>     ::= <string> | <arity-word>
    <atom>           ::= <bareword> | <string>
    <bareword>       ::= <bareword-char> { <bareword-char> }
    <bareword-char>  ::= <char> - ( <whitespace> | "[" | "]" | "(" | ")" | "," | ":" | "\\"" | ">" | "#" )
    <name-word>      ::= <name-char> { <name-char> }
    <name-char>      ::= <char> - ( <whitespace> | "(" | ")" | "\\"" )
    <arity-word>     ::= <arity-char> { <arity-char> }
    <arity-char>     ::= <char> - ( <whitespace> | "[" | "]" | "\\"" )
    <string>         ::= "\\"" { <string-char> } "\\""
    <string-char>    ::= ( <char> - ( "\\"" | "\\\\" | <newline> ) ) | ( "\\\\" ( <char> - <newline> ) )
    <comment>        ::= "#" { <char> - <newline> }
    <directive>      ::= "#config" <whitespace> { <whitespace> } <option> <whitespace> { <whitespace> } ( <string> | <word> )
                       | "#type" <whitespace> { <whitespace> } <type>
    <option>         ::= <letter> { <letter> | <digit> | "-" }
    <type>           ::= "graph" | "hub" | "grid"
    <word>           ::= <char> - <whitespace> { <char> - <whitespace> }
    <newline>        ::= "\\n"
    <whitespace>     ::= " " | "\\t" | "\\r"

### Lexical Rules

- A <bareword> must not contain the character sequence "--" at any position, as
  "--" always starts an edge operator.
- An <edge> is a single lexical token: no whitespace and no comment is allowed
  anywhere inside it, especially not between ">" and "[".
- Whitespace (except <newline>) is insignificant between all other tokens and
  never part of a token.
- A <newline> terminates a <statement>: statements cannot span multiple lines.
- A <comment> starts at an unquoted "#" and extends to the end of the line.
  Inside a <string>, "#" is an ordinary character.
- A <string> cannot span lines. Inside it, "\\" escapes the following character.
- A <directive> is a <comment> which occupies its entire line and starts with
  the keyword "#config" or "#type". All other comments are ignored.

### Semantic Rules

- In <node>, the first <atom> is the node id and the optional <atom> after ":"
  is the displayed node label. Without a label, the id is displayed.
- A node can be referenced multiple times. All references address the same node
  and merge their label and attributes into it, with later values overriding
  earlier ones for the same attribute key.
- Nodes which are never part of an <edge> are rendered free-standing.
- In a chain "a --> b --> c", each <edge> connects its immediately preceding and
  following node, i.e., the chain is equivalent to "a --> b" and "b --> c".
- The <edge-name> is rendered as the label of the edge and the <edge-arity> as
  its cardinality label.
- Four attribute keys are reserved and consumed by the renderer instead of being
  displayed as a regular "<key>: <val>" line:
  - "url: <url>" renders the node box as a hyperlink,
  - "type: <name>" renders <name> as a smaller text above the node label,
  - "primary: true" renders the node in the primary node colors (and, for the
    diagram type "hub", marks the single central hub node),
  - "group: <name>" places the node into the surrounding group box <name>.
- A node cannot be a member of more than one group. As soon as at least one node
  carries a "group" attribute, all nodes without one implicitly belong to the
  group "default", and every edge has to stay within a single group.
- All remaining attributes are displayed as "<key>: <val>" lines inside the node
  box.

### Example Input

    #type   graph

    #config color-node-primary-box  #336699
    #config color-edge-line         #999999

    Animal: animal [ type: "abstract class", kind: base, url: "#animal", primary: true ]
    Dog: dog
    Cat: cat

    Dog --(isa)--> Animal
    Cat --(isa)--> Animal
    "Pet Owner" --(owns)-->[0..*] Dog --(chases)-->[0..n] Cat

## Rendering Configuration

The optional "config" argument sets rendering options, equivalent to the
"#config <option> <value>" directives inside the input, but taking precedence
over them. The recognized options, with their types and built-in defaults, are:

${configOptions}

The "size-*", "group-*", "graph-*", "hub-*", and "grid-*" options control the
rendering geometry (canvas margin, node box sizing, edge routing, group box
spacing, and the per-diagram-type layout) and take non-negative numbers, except
the boolean "grid-node-width-equal", which forces all node boxes of a "grid"
diagram to the width of the widest one. The "font-family" and "color-*" options
are embedded into the generated SVG: when such an option is not explicitly
configured, the SVG instead references the CSS custom property
"--gradia-<option>" (definable by an embedding HTML document) and falls back to
the built-in default. Leave them unset unless a particular look is explicitly
requested.

## Result

The tool returns the rendered diagram as a single text result, in the requested
output format. For the "svg:*" formats this is the SVG/XML document, which is
usually written to a "*.svg" file; for the "url:*" formats it is a
"data:image/svg+xml" URL, usable as the "src" of an HTML "<img>" element.
`.trim()

/*  the arguments of the "gradia_render" tool  */
const toolArguments = {
    input: z.string()
        .describe("The graph description in the Gradia input language (see the tool description for its grammar)."),
    type: z.enum(diagramTypes as [ DiagramType, ...DiagramType[] ]).optional()
        .describe("The diagram type. Takes precedence over a \"#type\" directive inside the input. " +
            "Defaults to the \"#type\" directive of the input, else to \"graph\"."),
    format: z.enum(diagramFormats).optional()
        .describe("The output format: \"svg:standalone\" (a standalone SVG/XML document), " +
            "\"svg:embedded\" (the SVG without the \"<?xml?>\" declaration, for embedding into HTML), " +
            "\"url:xml\" (a \"data:image/svg+xml\" URL with URL-encoded XML), or " +
            "\"url:base64\" (a \"data:image/svg+xml\" URL with Base64-encoded XML). " +
            `Defaults to "${diagramFormatDefault}".`),
    config: z.record(z.string(), z.union([ z.string(), z.number(), z.boolean() ])).optional()
        .describe("The rendering configuration options (see the tool description for their names, " +
            "types, and defaults). Takes precedence over the \"#config\" directives inside the input.")
}

/*  validate and coerce the rendering configuration options of a tool
    call (the arguments are treated as untrusted, so an unknown option
    or an invalid value is rejected instead of being silently applied)  */
const validateConfig = (raw: Record<string, string | number | boolean>): Partial<Config> => {
    const config: Record<string, string | boolean | number> = {}
    for (const [ key, val ] of Object.entries(raw)) {
        if (!Object.hasOwn(configDefaults, key))
            throw new Error(`unknown configuration option "${key}"`)
        const k = key as keyof Config
        if (k === "font-embed")
            throw new Error(`configuration option "${key}" is not available in this context`)
        else if (typeof configDefaults[k] === "boolean") {
            if (typeof val !== "boolean" && val !== "true" && val !== "false")
                throw new Error(`invalid value "${String(val)}" for boolean configuration option "${key}" ` +
                    "(expected \"true\" or \"false\")")
            config[k] = typeof val === "boolean" ? val : val === "true"
        }
        else if (typeof configDefaults[k] === "number") {
            const num = Number(val)
            if (typeof val === "boolean" || val === "" || !Number.isFinite(num) || num < 0)
                throw new Error(`invalid value "${String(val)}" for numeric configuration option "${key}" ` +
                    "(expected a non-negative number)")
            config[k] = num
        }
        else {
            if (typeof val !== "string")
                throw new Error(`invalid value "${String(val)}" for string configuration option "${key}" (expected a string)`)
            if (k === "font-family" && val.endsWith(".woff2"))
                throw new Error("configuration option \"font-family\" must not be the path to a WOFF2 file in this context")
            config[k] = val
        }
    }
    return config as Partial<Config>
}

/*  the defaults of the MCP service, provided by the (trusted)
    command-line and underlying the arguments of every tool call  */
export interface MCPDefaults {
    type?:   DiagramType
    format?: DiagramFormat
    config?: Partial<Config>
}

/*  run the MCP service on stdio  */
export const serve = async (meta: { version: string }, defaults: MCPDefaults = {}) => {
    /*  establish the MCP server and its single tool  */
    const server = new McpServer({
        name:    "gradia",
        title:   "Gradia -- Object Graph Diagram Rendering",
        version: meta.version
    })
    server.registerTool("gradia_render", {
        title:       "Render an object graph as an SVG diagram",
        description: toolDescription,
        inputSchema: toolArguments,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
    }, async (args) => {
        try {
            const config = { ...defaults.config, ...validateConfig(args.config ?? {}) }
            const out    = await Gradia.render(args.input, {
                type:   args.type   ?? defaults.type,
                format: args.format ?? defaults.format,
                config
            })
            return { content: [ { type: "text" as const, text: out } ] }
        }
        catch (err: unknown) {
            return {
                isError: true,
                content: [ { type: "text" as const,
                    text: `gradia: ERROR: ${err instanceof Error ? err.message : String(err)}` } ]
            }
        }
    })

    /*  connect the MCP server to the stdio transport  */
    await server.connect(new StdioServerTransport())
}

