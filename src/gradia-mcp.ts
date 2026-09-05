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
import { Config, configDefaults }                         from "./gradia-api-config.js"
import { Gradia, DiagramType, diagramTypes, diagramTypeDefault,
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
  the general-purpose type and the built-in default. It accepts any topology,
  including self-loops and free-standing nodes.
- "hub": a hub graph, placing the single primary node (the node carrying the
  attribute "primary: true") in the center, its input nodes to the left and
  its output nodes to the right. It accepts only the constrained topology
  described below.
- "grid": a compact grid of tiles for an edge-less graph. The nodes are placed
  in declaration order onto a roughly square, row-major grid.

### Diagram Type Constraints

The "hub" type rejects the input with an error unless all of the following
conditions hold:

- Exactly one node carries the attribute "primary: true".
- Every edge either points to or originates from that primary node. An edge
  between two non-primary nodes is rejected.
- The primary node carries no self-loop.
- Every non-primary node is an input or an output of the primary node, i.e.,
  no node is free-standing.

A node which is both an input and an output of the primary node is placed
twice, once in the input column and once in the output column. The second
placement is rendered as a dashed "ghost" box, colored by the
"color-node-ghost-*" options.

The "grid" type rejects the input with an error as soon as the graph contains
at least one edge.

The "graph" type imposes no such constraints and hence is the safe choice
whenever the topology is not known to fit "hub" or "grid".

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
- Of multiple "#type" directives the last one wins, and a directive naming an
  invalid type is silently ignored. A "#config" directive naming an unknown
  option or carrying an invalid value is silently ignored, too, whereas the
  same mistake in the "config" tool argument is rejected with an error.

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
- Six attribute keys are reserved and consumed by the renderer instead of being
  displayed as a regular "<key>: <val>" line:
  - "url: <url>" renders the node box as a hyperlink. Only relative URLs and
    the schemes "http", "https", and "mailto" are honored; any other URL is
    silently dropped and the node box then simply stays unlinked,
  - "type: <name>" renders <name> as a smaller text above the node label,
  - "primary: true" renders the node in the primary node colors (and, for the
    diagram type "hub", marks the single central hub node). The value has to
    be the literal string "true",
  - "group: <name>" places the node into the surrounding group box <name>,
  - "parent: <id>" nests the node into the container node <id> (a node which
    is implicitly declared if never referenced otherwise),
  - "container: <type>" marks the node as a container whose members are laid
    out with the diagram type <type> ("graph", "hub", or "grid"), even if it
    has no members at all.
- A node cannot be a member of more than one group. As soon as at least one node
  carries a "group" attribute, all nodes without one implicitly belong to the
  group "default", and every edge has to stay within a single group. A nested
  node belongs to the group of its outermost container.
- The groups are laid out individually with the selected diagram type and then
  stacked vertically as decorated group boxes. For the type "hub" this means
  that every single group needs its own primary node.
- A node referenced as the "parent" of another node is a container: it is
  rendered as a dashed grey box surrounding its members instead of as a node
  box, with its label, "type", and "url" in the box head (its remaining
  attributes are not rendered). Containers nest to any depth, but a node cannot
  be a member of more than one container, and cannot be nested into itself.
- The members of a container are laid out as a diagram of their own, with the
  diagram type of the enclosing level unless overridden by "container: <type>",
  and the container then takes part in the layout of the enclosing level as a
  single box. Edges may connect any two nodes, across container boundaries and
  to container nodes themselves, except a container with one of its own
  members. An edge crossing the boundary of a container laid out as "graph" is
  routed through the box border to the inner node (entering on the west and
  leaving on the east side), while an edge crossing the boundary of a container
  laid out as "hub" or "grid" ends at the box border instead. The diagram type
  constraints apply to every container level (e.g., a "hub" container needs its
  own primary node, and a "grid" container permits no edges among its members).
- Use containers (not groups) to visualize zones, tiers, deployment units, or
  packages whose members are connected to the outside world.
- All remaining attributes are displayed as "<key>: <val>" lines inside the node
  box.

### Example Input

    #type   graph

    #config color-node-primary-box  #336699
    #config color-edge-line         #999999

    Animal: animal [ type: "abstract class", kind: base, url: "#animal", primary: true ]
    Dog: dog [ parent: Pets ]
    Cat: cat [ parent: Pets ]
    Pets: "Domestic Pets" [ type: package ]

    Dog --(isa)--> Animal
    Cat --(isa)--> Animal
    "Pet Owner" --(owns)-->[0..*] Dog --(chases)-->[0..n] Cat

## Rendering Configuration

The optional "config" argument sets rendering options, equivalent to the
"#config <option> <value>" directives inside the input, but taking precedence
over them. The recognized options, with their types and built-in defaults, are:

${configOptions}

The "size-*", "group-*", "container-*", "graph-*", "hub-*", and "grid-*" options
control the rendering geometry (canvas margin, node box sizing, edge routing,
group and container box spacing, and the per-diagram-type layout) and take
non-negative numbers, except the boolean "grid-node-width-equal", which forces
all node boxes of a "grid" diagram to the width of the widest one.

The "size-node-width-max" option additionally enables the word-wrapping of the
node box texts: given a positive value, the node name, its type, and its
attribute lines are greedily broken at whitespace, so that the node box stays
within the given width and grows in height instead. This is the only way to
produce multi-line node boxes. The default "0" disables the wrapping entirely
and hence lets a node box become as wide as its longest text. A single word
wider than the maximum is never broken and still widens the box beyond it.

The "grid-columns-min" and "grid-columns-max" options control the column count
of a "grid" diagram, which by default is derived from the node count as a
roughly square grid: "grid-columns-min" (default 3) raises the derived count,
so that a few nodes still share a single row instead of being stacked, while
"grid-columns-max" (default 4) caps it, so that larger diagrams grow in height
only. The column count never exceeds the node count and the maximum always
wins over the minimum.

The "font-family" and "color-*" options are embedded into the generated SVG:
when such an option is not explicitly configured, the SVG instead references
the CSS custom property "--gradia-<option>" (definable by an embedding HTML
document) and falls back to the built-in default. Leave them unset unless a
particular look is explicitly requested.

The "font-family" option is either the built-in font family "Source Sans 3" or
a plain font family name resolved by the displaying document. A path to a
WOFF2 file is rejected in this context, exactly like the option "font-embed":
both are available only through the (trusted) command-line options of the
service.

## Result

The tool returns the rendered diagram as a single text result, in the requested
output format. For the "svg:*" formats this is the SVG/XML document, which is
usually written to a "*.svg" file; for the "url:*" formats it is a
"data:image/svg+xml" URL, usable as the "src" of an HTML "<img>" element.

On a malformed input, a violated diagram type constraint, or an invalid "config"
argument, the tool instead returns an error result whose text starts with
"gradia: ERROR: ", followed by the reason.
`.trim()

/*  the arguments of the "gradia_render" tool (with their descriptions
    reflecting the service defaults underlying the arguments)  */
const toolArgumentsOf = (defaults: MCPDefaults) => ({
    input: z.string()
        .describe("The graph description in the Gradia input language (see the tool description for its grammar)."),
    type: z.enum(diagramTypes).optional()
        .describe("The diagram type. Takes precedence over a \"#type\" directive inside the input. " +
            (defaults.type !== undefined ?
                `Defaults to "${defaults.type}".` :
                `Defaults to the "#type" directive of the input, else to "${diagramTypeDefault}".`)),
    format: z.enum(diagramFormats).optional()
        .describe("The output format: \"svg:standalone\" (a standalone SVG/XML document), " +
            "\"svg:embedded\" (the SVG without the \"<?xml?>\" declaration, for embedding into HTML), " +
            "\"url:xml\" (a \"data:image/svg+xml\" URL with URL-encoded XML), or " +
            "\"url:base64\" (a \"data:image/svg+xml\" URL with Base64-encoded XML). " +
            `Defaults to "${defaults.format ?? diagramFormatDefault}".`),
    config: z.record(z.string(), z.union([ z.string(), z.number(), z.boolean() ])).optional()
        .describe("The rendering configuration options (see the tool description for their names, " +
            "types, and defaults). Takes precedence over the \"#config\" directives inside the input.")
})

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
            if (typeof val === "boolean" || String(val).trim() === "" || !Number.isFinite(num) || num < 0)
                throw new Error(`invalid value "${String(val)}" for numeric configuration option "${key}" ` +
                    "(expected a non-negative number)")
            config[k] = num
        }
        else {
            if (typeof val !== "string")
                throw new Error(`invalid value "${String(val)}" for string configuration option "${key}" (expected a string)`)
            if (val === "")
                throw new Error(`invalid empty value for string configuration option "${key}"`)
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
        inputSchema: toolArgumentsOf(defaults),
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

