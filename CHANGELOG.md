
ChangeLog
=========

1.2.1 (2026-09-05)
------------------

-   FEATURE [code, othr]: support the new "order" attribute, placing the nodes of a "graph"
    explicitly instead of by the layered algorithm (the distinct order values as top-down rows,
    the nodes of one value left-to-right, wrapped beyond "graph-columns-max") and sorting the
    tiles of a "grid", so a reading order can be imposed which lets the references point backward
-   IMPROVEMENT [othr]: document the "order" attribute in the README and the MCP tool description

1.2.0 (2026-09-05)
------------------

-   FEATURE [code, othr]: support container nodes with sub-graphs via the new "parent" and
    "container" attributes, nesting nodes to any depth into dashed container boxes whose
    members are laid out as a diagram of their own ("graph", "hub", or "grid")
-   FEATURE [code, othr]: support new "color-container-*" and "container-box-padding" options
    for coloring and padding the container boxes
-   IMPROVEMENT [code]: route the edges crossing a "graph" container boundary through the box
    border to the inner node, and end those crossing a "hub" or "grid" container at the border
-   IMPROVEMENT [code]: order the edge tracks of large channels/gutters by a local search moving
    blocks of adjacent edges, which finds orders with considerably fewer crossings
-   IMPROVEMENT [code]: let the edge labels also dodge the edge lines and their crossing hops,
    preferring the position covering the fewest lines
-   IMPROVEMENT [code, othr]: document the container nesting in the README and the MCP tool
    description, and fix the grammar in the README
-   IMPROVEMENT [infr, othr]: add the "container-sample" sample graph and render it in the "sample" target
-   IMPROVEMENT [othr]: re-render the sample SVG diagrams
-   BUGFIX [code]: avoid collinear overlaps of edges in channels/gutters, where the exit stub of one
    edge and the entry stub of another at the same position ran on top of each other, by
    letting such overlaps dominate the crossings in the edge track ordering
-   BUGFIX [code]: keep the self-loops of a "graph" diagram clear of the neighboring nodes: route
    their legs on tracks of the channel beside their node, as the legs of stacked self-loops ran
    into the boxes of the next column and on top of the other channel edges, and size the gutter
    above the looped node to hold the detour above its box, which ran straight through the node
    above in the same column
-   BUGFIX [code]: keep the boundary gates of a "graph" container level in the row order of
    their connected nodes, where a gate displaced into a newly inserted row shifted the nodes
    below it while the later gates still targeted the old rows, letting their edges cross
-   BUGFIX [code]: render a self-loop on a container node, which was silently dropped together
    with its label, by routing it at the enclosing level around the container box
-   BUGFIX [code]: keep the edge ports of a container box inside the box, where the ports of its
    own edges were spread over the full box height and then pushed below the box by the fixed
    port of an inner gate, by spacing all ports together and dealing the free ports into the
    gaps around the fixed ones
-   BUGFIX [code]: clamp the node box height to at least its text content height, as a
    "size-node-height-scale" below 2 let the type line and the last attribute line
    overflow the box
-   BUGFIX [code]: validate the "config" options given to the API facade, which so far reached
    the renderers unchecked (unknown options, wrong-typed or negative values), by sharing one
    validation between the API, the CLI, the MCP service, and the "#config" directives
-   BUGFIX [code]: reject a consumer-built graph model whose node map key and node id disagree
    or whose edge references an undeclared node, instead of rendering an inconsistent partial
    or silently broken output with "NaN" path coordinates
-   CLEANUP [code]: clean up the source code based on lint findings, moving the shared layout
    types into the render base module, splitting the container level layout into focused
    functions, and rejecting node ids carrying the control character reserved for the gate ids

1.1.9 (2026-09-04)
------------------

-   IMPROVEMENT [code]: compact the sparsely occupied rows of "graph" diagrams by lifting
    edge-less nodes into free cells and merging rows without a column occupied in both
-   IMPROVEMENT [othr]: re-render the sample SVG diagrams

1.1.8 (2026-09-04)
------------------

-   BUGFIX [code]: fix positioning of node boxes to avoid overlaps

1.1.7 (2026-09-03)
------------------

-   BUGFIX [code]: balance the vertical padding of node boxes with attributes, which was larger at the bottom

1.1.6 (2026-09-02)
------------------

-   IMPROVEMENT [code]: order the edge tracks of a channel/gutter by exactly minimizing their crossings
-   IMPROVEMENT [code]: nudge "graph" nodes vertically off their row center to straighten direct edges
-   IMPROVEMENT [othr]: re-render the sample SVG diagrams

1.1.5 (2026-09-02)
------------------

-   IMPROVEMENT [othr]: document the default values of the rendering options in the README
-   IMPROVEMENT [othr]: improve the "huica-sample" sample graph and its rendered SVG
-   BUGFIX [code, othr]: order the "graph" edge ports by their gutter track approach to avoid crossings
-   UPGRADE [infr]: upgrade NPM dependencies

1.1.3 (2026-08-23)
------------------

-   IMPROVEMENT [code]: route the "graph" self-loops around the top-right box corner for intuition
-   IMPROVEMENT [code]: place the edge arity beside the line for vertically approaching edges
-   IMPROVEMENT [infr, othr]: add the "huica-sample" sample graph and render it in the "sample" target
-   IMPROVEMENT [othr]: re-render the sample SVG diagrams

1.1.2 (2026-08-23)
------------------

-   BUGFIX [infr]: add a NPM "prepublishOnly" script which ensures that "npm start build" runs before release

1.1.1 (2026-08-23)
------------------

-   FEATURE [code, othr]: support new "size-edge-port-gap" option to space out the edge attachment ports of a node side

1.1.0 (2026-08-23)
------------------

-   FEATURE [code, othr]: support new "graph-channel-width-min" option to space out column channels
-   FEATURE [code, othr]: support new "graph-gutter-height-min" option to space out row gutters
-   IMPROVEMENT [code]: size the "graph" column channels by the widest edge name landing inside them
-   IMPROVEMENT [code]: size the "graph" column channels by the edge arity set back from the arrow head
-   IMPROVEMENT [code]: size the "graph" row gutters by the number of edge names placed along their run
-   CLEANUP [code]: share the edge arity setback constant between SVG rendering and graph layout

1.0.1 (2026-08-21)
------------------

-   UPGRADE: upgrade NPM dependencies

1.0.0 (2026-08-20)
------------------

-   FEATURE [code]: switch the ids in SVG from a PRNG-based NanoID to a SHA1-based UUIDv5 for stable rendering
-   FEATURE [code, othr]: support new "grid-columns-min" option to avoid tiny grids
-   FEATURE [othr]: add a "CHANGELOG.md" file documenting the release history
-   IMPROVEMENT [code]: reduce "graph-columns-max" default to keep diagrams narrower
-   IMPROVEMENT [code]: harden the XML/CSS escaping and the configuration validation
-   IMPROVEMENT [code]: load the MCP service lazily and freeze the "Gradia.config" object
-   BUGFIX [code]: use "btoa" instead of "Buffer" for Base64 URLs in the Web bundle
-   CLEANUP [code]: code cleanups in parser, renderers, diagram types, API, CLI and MCP

0.9.9 (2026-08-20)
------------------

-   FEATURE [code, othr]: support new "grid-node-width-equal" option, defaulting to true

0.9.8 (2026-08-19)
------------------

-   IMPROVEMENT [code, othr]: port dynamic node box height from "hub" to "graph" diagrams

0.9.7 (2026-08-19)
------------------

-   IMPROVEMENT [code]: improve rendering of vertical edge lines in "hub" diagrams
-   IMPROVEMENT [code]: reduce minimum node box height and re-center the name lines

0.9.6 (2026-08-19)
------------------

-   IMPROVEMENT [code]: improve node text rendering by adjusting the text metrics

0.9.5 (2026-08-19)
------------------

-   FEATURE [code, othr]: support new "hub-node-degree-max" option for dynamic hub nodes

0.9.4 (2026-08-19)
------------------

-   FEATURE [code]: expose the rendering configuration defaults as "Gradia.config"

0.9.3 (2026-08-19)
------------------

-   FEATURE [code, infr, othr]: support new "size-node-width-max" option, wrapping texts

0.9.2 (2026-08-19)
------------------

-   FEATURE [code, othr]: support new "color-edge-halo" option for the edge line halo

0.9.1 (2026-08-18)
------------------

-   FEATURE [code, infr, othr]: add MCP service exposing the `gradia_render` tool
-   FEATURE [code, infr, othr]: support the built-in "Source Sans 3" font as a local copy
-   FEATURE [code, infr, othr]: make all rendering parameters configurable
-   FEATURE [code, infr, othr]: support `--gradia-*` CSS variables for config options
-   FEATURE [code, infr]: support the "#type" directive inside the input specification
-   FEATURE [infr, othr]: add a UMD bundle via Vite for the Web usage, plus a playground
-   IMPROVEMENT [code, infr]: prefix all identifiers in the generated SVG with nanoids
-   IMPROVEMENT [infr, othr]: update README and fix its badge rendering and typography
-   CLEANUP [code]: code cleanups in parser, SVG renderer, "hub" type, API and CLI
-   CLEANUP [infr]: remove unused ESLint plugins and fix the stx configuration

0.9.0 (2026-08-18)
------------------

(first rough cut)

