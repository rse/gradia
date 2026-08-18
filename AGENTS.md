## About

**gradia** is the opinionated tooling of *Dr. Ralf S. Engelschall*
for *Object Graph Diagram Rendering*: a small CLI for rendering
directed graphs, described in a concise textual input language, as SVG
diagrams. Three diagram types are supported: `graph` (a grid-snapped
layered layout of the whole graph, based on the Dagre algorithm of
`@antv/layout`), `hub` (a hub graph, placing one primary hub node
between its input and output nodes), and `grid` (a compact grid of
tiles for an edge-less graph).

## Repository Layout

-   `src/`: the TypeScript sources
    -   `src/gradia-cli.ts`: the Commander-based CLI (thin wrapper over the API)
    -   `src/gradia-api.ts`: the rendering API `renderDiagram`, wiring
        parser, configuration, group partitioning, the per-type
        renderers, and the SVG output
    -   `src/gradia-api-model.ts`: the graph model types (`Attr`, `Node`, `Edge`, `Graph`)
    -   `src/gradia-api-parser.ts`: the input language parser, producing the graph model
    -   `src/gradia-api-config.ts`: the rendering options (defaults,
        in-input directive parsing, font resolution)
    -   `src/gradia-api-render-base.ts`: shared rendering geometry/font
        constants and text width measurement
    -   `src/gradia-api-render-node.ts`: node box measurement and styling helpers
    -   `src/gradia-api-render-edge.ts`: edge routing (port/track
        assignment, polyline simplification, hop computation, SVG path
        generation)
    -   `src/gradia-api-render-group.ts`: group partitioning of the
        graph and composition of the per-group layouts
    -   `src/gradia-api-render-svg.ts`: the final SVG document generation from a `Layout`
    -   `src/gradia-api-type-graph.ts`: the `graph` diagram type (layered
        layout via the Dagre algorithm of `@antv/layout`)
    -   `src/gradia-api-type-hub.ts`: the `hub` diagram type (hub graph layout)
    -   `src/gradia-api-type-grid.ts`: the `grid` diagram type (compact grid layout)
-   `etc/`: the tool configurations (`eslint.mjs`, `tsconfig.json`, `stx.conf`)
-   `smp/`: the sample graph descriptions (`*.txt`) and their rendered
    SVG outputs (`*.svg`)
-   `dst/`: the compiled output (`bin` `gradia` is `dst/gradia-cli.js`)
    -- never edit it, it is regenerated

## Build System

Build orchestration uses `@rse/stx`, not plain npm scripts. The only npm
script is `npm start`, which invokes stx with `etc/stx.conf`:

```
npm start build         # lint + build-cmd
npm start build-cmd     # tsc --project etc/tsconfig.json (emits into dst/)
npm start lint          # eslint --config etc/eslint.mjs src/*.ts
npm start build-watch   # nodemon rebuild on src/**/*.ts
npm start lint-watch    # nodemon relint on src/**/*.ts
npm start sample        # render the smp/*.txt samples into smp/*.svg
npm start clean         # remove regularly built files
npm start distclean     # also remove node_modules and package-lock.json
```

No test target is defined.

## CLI Command

```
gradia [-t graph|hub|grid] [-f <format>] [-o <file>.svg] [--<render-option> <value>] <graph>.txt
```

The output format is `svg:standalone` (a standalone SVG/XML document,
the default), `svg:embedded` (the SVG without the `<?xml?>` declaration,
for direct embedding into HTML), `url:xml` (a `data:image/svg+xml` URL
with URL-encoded XML), or `url:base64` (a `data:image/svg+xml` URL with
Base64-encoded XML).

The rendering options (`--font-family`, `--font-embed`, and the
`--color-*` family) can also be set through `#<option> <value>`
directives inside the input, except `--font-embed` and WOFF2 file paths,
which are command-line-only, as the input is treated as untrusted.

## Code Style

Strict TypeScript conventions are enforced in `src/`: no semicolons
(except inside `for`), double quotes, K&R braces, no braces around
single-statement `if`/`while` blocks, vertically-aligned operators
on similar consecutive lines, `/* ... */` block comments with two
leading/trailing spaces, parens around all arrow parameters, and line
breaks before `else`/`catch`/`finally`. Match existing formatting
exactly when editing.
