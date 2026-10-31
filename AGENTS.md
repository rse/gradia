## About

**gradia** is the opinionated tooling of *Dr. Ralf S. Engelschall*
for *Object Graph Diagram Rendering*: a small CLI for rendering
directed graphs, described in a concise textual input language, as SVG
diagrams. Ten diagram types are supported: `graph` (a grid-snapped
layered layout of the whole graph, based on the Dagre algorithm of
`@antv/layout`), `hub` (a hub graph, placing one primary hub node
between its input and output nodes), `grid` (a compact grid of
tiles for an edge-less graph), `layer` (a layered architecture of
stacked layer bands, marking the edges against the layering), `slice`
(a sliced architecture of side-by-side slice bands, marking the edges
closing a direct cycle between two slices), `tree` (a tidy tree or
forest with bus connectors, stacked leaves, and dashed cross links),
`matrix` (a dependency
structure matrix, outlining its cycles), `sequence` (a sequence
diagram of participants, their lifelines, and their messages),
`state` (a state machine with pseudo-states and composite states,
optionally split into orthogonal regions,
marking its unreachable, dead-end, and incomplete states and its
conflicting transitions), and `petri` (a Petri net of places with
tokens and transitions, optionally with inhibitor arcs, marking its
dead and non-live transitions and its unreachable, unbounded, and
deadlocked places, as determined by its coverability graph, and
attaching the analysis results to its nodes as tooltips).

## Repository Layout

-   `src/`: the TypeScript sources
    -   `src/gradia-cli.ts`: the Commander-based CLI (thin wrapper over the API)
    -   `src/gradia-mcp.ts`: the MCP service on stdio (the
        `gradia_render` tool, wrapping the API `render` method)
    -   `src/gradia-api.ts`: the API facade class `Gradia` (static
        methods `parse`, `generate`, and the combined `render`, plus the
        static `config` of the option defaults), wiring parser,
        configuration, group partitioning, container nesting, the
        per-type renderers, and the SVG output, plus the re-exported
        companion types (`Graph`, `Node`, `Edge`, `EdgeKind`, `Attr`,
        `Config`)
    -   `src/gradia-api-model.ts`: the graph model types (`Attr`, `Node`,
        `Edge`, `EdgeKind`, `Graph`) and the list `edgeKinds`
    -   `src/gradia-api-parser.ts`: the input language parser, producing the graph model
    -   `src/gradia-api-config.ts`: the rendering options (defaults,
        validation, in-input directive parsing, CSS value resolution,
        font resolution)
    -   `src/gradia-api-render-base.ts`: shared rendering geometry/font
        constants, text width measurement, and text word-wrapping
    -   `src/gradia-api-render-shape.ts`: the free-standing `Shape`
        primitives a diagram type draws beside its node boxes and edges
    -   `src/gradia-api-render-node.ts`: node box text line breaking,
        measurement, and styling helpers, plus the accessors of the
        reserved node attributes (e.g. `order`, `cluster`, `badge`, `mark`)
    -   `src/gradia-api-render-edge.ts`: edge routing (port/track
        assignment, polyline simplification, hop computation, SVG path
        generation)
    -   `src/gradia-api-render-group.ts`: group partitioning of the
        graph and composition of the per-group layouts
    -   `src/gradia-api-render-container.ts`: container nesting
        (`parent`/`container` attributes): the containment tree, the
        recursive per-level layout with container placeholders and
        boundary gate nodes, and the stitching of the boundary-crossing
        edges
    -   `src/gradia-api-render-svg.ts`: the final SVG document generation from a `Layout`
    -   `src/gradia-api-type-graph.ts`: the `graph` diagram type (layered
        layout via the Dagre algorithm of `@antv/layout`, explicit `order`
        layout, and the uniform, optionally transposed, lane layout
        underlying `layer` and `slice`)
    -   `src/gradia-api-type-hub.ts`: the `hub` diagram type (hub graph layout)
    -   `src/gradia-api-type-grid.ts`: the `grid` diagram type (compact grid layout)
    -   `src/gradia-api-type-layer.ts`: the `layer` diagram type (a uniform
        `graph`, its layers drawn as bands and its violations marked)
    -   `src/gradia-api-type-slice.ts`: the `slice` diagram type (a uniform
        and transposed `graph`, its slices drawn as bands and its cycles marked)
    -   `src/gradia-api-type-tree.ts`: the `tree` diagram type (a tidy
        tree layout with bus connectors, stacked leaves, and cross links)
    -   `src/gradia-api-type-matrix.ts`: the `matrix` diagram type (the
        headers and cells of a dependency structure matrix, as shapes)
    -   `src/gradia-api-type-sequence.ts`: the `sequence` diagram type
        (participants, messages, and lifelines)
    -   `src/gradia-api-type-state.ts`: the `state` diagram type (a
        `graph` with distinct transitions and pseudo-state shapes, the
        orthogonal regions rewritten into synthetic region containers and
        stacked as bands, plus the validation and the reachability and
        dead-end analysis of the whole state machine, marking its states
        via the `mark` attribute)
    -   `src/gradia-api-type-petri.ts`: the `petri` diagram type (a
        `graph` with distinct arcs, opposite arcs merged into two-way
        ones, its places drawn as circles with their tokens, plus the
        inference of the node kinds, the validation, and the
        coverability graph and liveness analysis of every connected
        part of the net, marking its places and transitions via the
        `mark` attribute and attaching the results as tooltips)
-   `etc/`: the tool configurations (`eslint.mjs`, `tsconfig.json`,
    `stx.conf`, `vite.ts`)
-   `smp/`: the sample graph descriptions (`*.txt`), their rendered
    SVG outputs (`*.svg`), the playground (`playground.html`), and the
    regression test diagrams (`broadcast.d/*.txt`, the non-trivial
    diagrams of the SpecBook "broadcast" sample specification)
-   `dst/`: the compiled output (`bin` `gradia` is `dst/gradia-cli.js`,
    the `main` API module is `dst/gradia-api.js` with its typings
    `dst/gradia-api.d.ts`, and the browser UMD bundle of the API is
    `dst/gradia-api.umd.js`)
    -- never edit it; it is regenerated

## Build System

Build orchestration uses `@rse/stx`, not plain npm scripts. The only npm
script is `npm start` (besides the `prepublishOnly` hook running `npm
start build`), which invokes stx with `etc/stx.conf`:

```
npm start build         # lint + build-cmd + build-web
npm start build-cmd     # tsc --project etc/tsconfig.json (emits into dst/)
npm start build-web     # vite --config etc/vite.ts build (emits dst/gradia-api.umd.js)
npm start lint          # eslint --config etc/eslint.mjs src/*.ts
npm start build-watch   # nodemon rebuild on src/**/*.ts
npm start lint-watch    # nodemon relint on src/**/*.ts
npm start sample        # render the smp/*.txt samples into smp/*.svg
npm start regression-before  # render smp/broadcast.d/*.txt into *.before.svg (reference)
npm start regression-after   # render into *.after.svg and report the differing diagrams
npm start regression-clean   # remove the rendered *.before.svg and *.after.svg files
npm start clean         # remove regularly built files
npm start distclean     # also remove node_modules and package-lock.json
```

No test target is defined.

## CLI Command

```
gradia [-t graph|hub|grid|layer|slice|tree|matrix|sequence|state|petri] [-f <format>] [-c <name>=<value>] -o <file>.svg <graph>.txt
```

Both the `-o`/`--output` option and the input file argument are
required, except in MCP service mode (see below).

The output format is `svg:standalone` (a standalone SVG/XML document,
the default), `svg:embedded` (the SVG without the `<?xml?>` declaration,
for direct embedding into HTML), `url:xml` (a `data:image/svg+xml` URL
with URL-encoded XML), or `url:base64` (a `data:image/svg+xml` URL with
Base64-encoded XML).

The diagram type is either given through the `--type` command-line
option or through a `#type <type>` directive inside the input, with the
command-line option taking precedence (the built-in default is `graph`).

With `--mcp`, the CLI instead runs as an MCP service on stdio (and then
accepts neither the input argument nor `--output`), exposing the single
tool `gradia_render` with the arguments `input`, `type`, `format`,
and `config`, whose description carries the entire input language
grammar and the recognized rendering options. The `--type`, `--format`,
and `--config` command-line options act as the defaults underlying the
tool call arguments. As the tool call arguments are untrusted, their
`config` rejects `font-embed` and WOFF2 `font-family` values, exactly
like the in-input `#config` directives do.

All identifiers inside the generated SVG are namespaced with a
`gradia-<uuid>-` prefix, derived per rendered document, so that multiple
diagrams can be embedded into one and the same document without
colliding in the DOM-global identifier namespace. The `<uuid>` is the
first 12 digits of the Base16 form of a UUID v5 (via `pure-uuid`, under
a Gradia-specific namespace) over everything which determines the
rendered output -- the diagram type, the layered configuration (the
options of the `seedLate` set only once deviating from their default,
keeping the identifiers of older diagrams stable), the keys of the
explicitly configured options, and the graph model -- so regenerating
an unchanged diagram yields a byte-identical SVG. The CSS classes are
likewise named `gradia-<digest>`, with the first 8 such digits over
their own declarations.

The rendering options (`font-family`, `font-embed`, the `color-*`
family, the numeric geometry families `size-*`, `group-*`,
`container-*`, `graph-*`, `hub-*`, `grid-*`, `sequence-*`, and
`tree-*`, and the booleans `grid-node-width-equal`,
`grid-node-height-equal`, `mark-violation`, `layer-numbered`,
`slice-numbered`, `tree-stack-double`, `tree-node-width-equal`, and
`tree-horizontal`) are set through the repeatable
`--config <name>=<value>` command-line option, or through `#config
<option> <value>` directives inside the input, except `font-embed` and
WOFF2 file paths, which are command-line-only, as the input is treated
as untrusted. The `font-family` and `color-*` options are embedded into
the SVG as CSS values: explicitly configured values are hard-coded, all
others become `var(--gradia-<option>, <default>)` CSS custom property
lookups resolvable by the embedding document (precedence: explicit
config, then CSS `--gradia-<option>`, then the built-in default).

The `font-family` option is either a built-in font family, a plain font
family name, or the path to a WOFF2 file. The only built-in font family
is `Source Sans 3`, the variable upright WOFF2 file of the NPM
dependency `source-sans`, which under `font-embed` is base64-embedded
into the SVG (with a `font-weight: 200 900` descriptor for its weight
axis) and hence requires no external font file at all.

## Code Style

Strict TypeScript conventions are enforced in `src/`: no semicolons
(except inside `for`), double quotes, K&R braces, no braces around
single-statement `if`/`while` blocks, vertically-aligned operators
on similar consecutive lines, `/* ... */` block comments with two
leading/trailing spaces, parens around all arrow parameters, and line
breaks before `else`/`catch`/`finally`. Match existing formatting
exactly when editing.
