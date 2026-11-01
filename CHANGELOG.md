
ChangeLog
=========

2.0.1 (2026-11-01)
------------------

-   IMPROVEMENT [code, othr]: let the gates of a container boundary share the row of their inner
    node and sit at the very ports their edges take there, so the stubs between them run straight,
    and never bundle the edges attaching at such fixed ports, so each keeps a track of its own and
    an edge crossing several containment levels is followable, plus the sample "graph-gates".

2.0.0 (2026-11-01)
------------------

-   FEATURE [code, othr]: add the diagram type "gantt", a Gantt chart of tasks (node attributes
    "duration" and "start", milestones as diamonds) over a time axis of abstract units, with typed
    dependencies ("{ type: fs|ss|ff|sf }", lags via "duration") as arrows, scheduled by the critical
    path method, drawing the slack as whiskers and marking the critical path, plus samples.

-   FEATURE [code, othr]: add the diagram type "petri", a Petri net of places (circles with tokens,
    "tokens"/"capacity" attributes, "color-node-place-*" colors) and transitions, with inferred node
    kinds ("petri" attribute), arc weights, inhibitor arcs (new edge kind "inhibitor"), and merged
    two-way arcs, analyzed through its coverability graph (marking dead, non-live, unreachable,
    unbounded, and dead-end nodes, with the results as tooltips), plus samples and examples.

-   FEATURE [code, othr]: add the diagram type "state", a state machine laid out like a "graph",
    with pseudo-states (node attribute "state"), composite states (containers), and orthogonal
    regions (node attribute "region"), validating the state machine and marking its unreachable,
    dead-end, and incomplete states (node attribute "mark") and conflicting transitions, plus samples.

-   FEATURE [code, othr]: add the diagram type "sequence" (participants on top of dashed
    lifelines, messages top-down in declaration order, self messages looping on their lifeline),
    based on free-standing "shapes" of a "Layout", the new "color-node-lifeline" option, and the
    "nestable" flag of the diagram type registry, plus a sequence diagram example in the playground
    (contributed by Matthias Brusdeylins in PR #8).

-   FEATURE [code, othr]: add edge attributes "{ kind: sync|async|return }" after the target node,
    rendered by the "sequence" diagram type as message kinds (hollow arrow head for asynchronous
    messages, dashed line and hollow arrow head for returns) plus activation bars derived from the
    call/return pairs.

-   FEATURE [infr, othr]: add a small Broadcast based regression test suite (the "smp/broadcast.d"
    diagrams plus the "regression-before", "regression-after", and "regression-clean" targets).

-   FEATURE [code, othr]: add the node attributes "badge" (renders a badge icon on the node) and
    "multiple" (renders the node as a stack of nodes), with the new "smp/badge-sample" sample.

-   FEATURE [code, othr]: add the diagram type "matrix", a dependency structure matrix (DSM) whose
    cells count the edges between the nodes, ordered topologically (or by "order"), with every
    cycle outlined as a dashed block on the diagonal (its closing edges in the new
    "color-mark-violation" color) and the new node attribute "cluster" partitioning the matrix.

-   FEATURE [code, othr]: add the diagram type "layer", a layered architecture whose layers (node
    attribute "layer") stack top-down as bands of a uniform "graph", drawing every upward edge
    against the layering dashed in the "color-mark-violation" color, grouping the layers through
    "cluster", and numbering them through the new option "layer-numbered", plus samples.

-   FEATURE [code, othr]: add the diagram type "slice", the companion of "layer": slices (node
    attribute "slice") line up left-to-right as bands of a uniform, transposed "graph", drawing
    every edge closing a direct cycle between two slices dashed in the "color-mark-violation"
    color, grouping the slices through "cluster", and numbering them through "slice-numbered".

-   IMPROVEMENT [code]: change the default of the option "color-mark-violation" from a red
    ("#cc3333") to a brown ("#b06820").

-   FEATURE [code]: add the boolean option "mark-violation" (default "true"), which with "false"
    disables the marking of the violations of the diagram types "matrix" (the counts of the edges
    closing a cycle and the dashed cycle outlines), "layer", and "slice" (the dashed edges in the
    "color-mark-violation" color), while keeping their layout unchanged.

-   IMPROVEMENT [code]: draw the node "badge" inside the node box, vertically centered at its left
    end (and in the "matrix" headers in front of their labels), instead of on the top border, so no
    layout has to reserve room above the boxes anymore, with thinner badge borders and badges sized
    relative to the font of their label.

-   FEATURE [code, othr]: add the diagram type "tree", a tidy tree (or forest) with every parent
    centered over its packed child subtrees and connected through a bus, leaf children stacked
    along a trunk, and non-tree edges drawn as dashed cross links, optionally laid out horizontally,
    plus the new "tree-*" options and the "smp/sample-tree-*" samples.

-   IMPROVEMENT [code]: render "sequence" diagrams more compact by keeping every participant box in
    its own width and spacing every pair of neighboring lifelines individually, plus the new options
    "sequence-column-gap" and "sequence-message-gap" (defaults "20" and "40") and slightly thicker
    lifelines.

-   BUGFIX [code]: in a "matrix" diagram, outline the part of a cycle within a cluster only if it
    holds at least one edge among its own members, as an empty dashed block suggested a local cycle
    which only closes through other clusters.

-   IMPROVEMENT [othr]: extend the playground to all samples (and hence all diagram types), rename
    the samples after their diagram type ("sample-<type>-<variant>"), merge the former "layer-*"
    and "slice-*" samples into "sample-layer-regular" and "sample-slice-regular", and remove the
    redundant "matrix-*" and "slice-sample" samples.

-   IMPROVEMENT [othr]: add the sample "sample-hub-crowded", a "hub" diagram (derived from the
    "Service" component of the Broadcast regression diagrams) whose input and output columns both
    wrap into two staggered sub-columns through the option "hub-node-count-max".

-   IMPROVEMENT [code]: bundle the edges of crowded channels and gutters onto common tracks (same
    name, target side, and arity, or else same source side), joined and left at junctions marked by
    a dot, instead of squeezing their tracks into one grey bar, sizing the channels and gutters by
    their bundled tracks and lining up the name labels of a bundle in one column.

-   IMPROVEMENT [code]: merge the edge ends of a bundle beside its node into one port, so the bundle
    enters its target (or leaves its source) through a single stub, with a single arrow head, arity
    and name label, and the freed ports let the box shrink, with the larger port separation for the
    name label applied only to the node sides holding such a merged port, and the merging kept only
    if it does not enlarge the diagram.

-   IMPROVEMENT [code]: in diagrams with crowded channels or gutters, bridge the closely spaced
    crossings of a segment with one flat bridge instead of one wide arc (merging the hops whenever
    the flat piece between them would be shorter than two hops), as they would turn into a wavy line.

-   IMPROVEMENT [code, othr]: draw the segments shared by bundled edges only once, instead of
    overpainting them once per edge.

-   IMPROVEMENT [code, othr]: place the edge names right in front of their arrow heads, beside
    their arities, instead of searching a position along their routes, so every name is clearly
    attributable to its edge, with fallbacks back along the stub, below the line, and along the
    route, while "sequence" diagrams keep their names centered on the messages.

-   IMPROVEMENT [code, othr]: pack the columns of a layered "graph" diagram vertically: every
    column stacks its nodes in row order instead of centering them in uniform rows, gutters span
    only the columns their tracks cross, and edge-less nodes trail below all connected nodes in
    declaration order, which shrinks dense diagrams by up to a third of their height.

1.4.4 (2026-10-27)
------------------

-   IMPROVEMENT [code]: speed up the rendering of very large "graph" and "hub" diagrams by bounding
    the local search of the track crossing minimization for more than 100 track users per channel
    or gutter (blocks of at most 8 users, best move per block, at most 100 passes) and by skipping
    the node nudging for more than 300 edges.

-   IMPROVEMENT [code]: further speed up the rendering of large "graph" and "hub" diagrams, with
    byte-identical output, by precomputing the track order cost changes once, by sweeping the
    vertical segments when detecting edge crossings, and by indexing the edge lines and label
    areas in a bucket grid for the label placement.

-   UPDATE [infr]: upgrade the NPM dependencies.

1.4.3 (2026-10-10)
------------------

-   UPDATE [infr]: upgrade the "@modelcontextprotocol/sdk", "eslint", "typescript-eslint",
    "neostandard", "globals", "@types/node", and "vite" dependencies to their latest versions

1.4.2 (2026-09-20)
------------------

-   IMPROVEMENT [code]: in a single-column layout, widen the container placeholders to the
    widest one, so the stacked container boxes line up (their content stays centered and their
    height the one of their content)

1.4.1 (2026-09-20)
------------------

-   IMPROVEMENT [code]: reserve the position beside its own arrow head for every arity label before
    any edge name label is placed, so a name yields that area wherever it has an alternative and
    only a name left without one still pushes its arity onto the next setback

-   IMPROVEMENT [code]: slide an edge name label over the whole of every segment of its route
    instead of offering it at a few fixed fractions of the route only, as the free space along a
    route is regularly not where the sampled points are

1.4.0 (2026-09-20)
------------------

-   IMPROVEMENT [code, docs]: grow a node box up to the height holding all of its edge attachment
    ports at the full "size-edge-port-gap" instead of packing them into its textual content height,
    so the parallel edges of a node and their labels stay readably apart

-   IMPROVEMENT [code, docs]: raise the port separation of a diagram whose edges carry arities to
    what those labels demand, so a node box grows to host its arrow heads far enough apart for the
    arity of each to sit readably beside its own arrow

-   IMPROVEMENT [code]: let an arity label stay at the arrow head of its edge instead of dodging
    the edge lines, as its halo keeps it readable on top of a line while a drift away from its own
    arrow left it ambiguous between the neighboring ports of a node

-   IMPROVEMENT [code]: offer an arity label both sides of its edge line at three setbacks from its
    arrow head, each stepping by the label extent, as the three positions within one label width
    left it on top of the very label it had to dodge

-   IMPROVEMENT [code]: let an edge label keep a clearance from the foreign edge lines, so a label
    which merely does not overlap a parallel foreign line no longer reads as the annotation of that
    line instead of the one of its own edge

-   IMPROVEMENT [code, docs]: apply "hub-node-count-max" to the larger column of a "hub" diagram
    alone and let its tallest resulting (sub-)column cap the smaller column implicitly, so a column
    wraps exactly if that lowers the height of the diagram

-   FEATURE [code, docs]: make the font sizes of the node names, node types, node properties, edge
    names, and edge arities configurable through the new "size-font-node", "size-font-type",
    "size-font-prop", "size-font-edge", and "size-font-arity" options, which size the layout and
    are overridable at display time through their CSS custom properties

1.3.0 (2026-09-19)
------------------

-   FEATURE [code, docs]: wrap an input/output column of a "hub" diagram with more nodes than the
    new "hub-node-count-max" option into two staggered sub-columns, the edges of the outer nodes
    running through the gaps of the inner ones, which nearly halves the height of a large diagram

-   IMPROVEMENT [code, docs]: style the SVG elements through content-named CSS classes declared
    once per document instead of a lengthy inline style per element, and shorten the identifier
    prefix to 12 digits, which about halves the size of the generated SVG

1.2.4 (2026-09-19)
------------------

-   FEATURE [code, docs]: accept a self-loop on the primary node of a "hub" diagram by placing the
    primary a second time on top of the output column, rendered as a dashed "self" box, colored
    by the new (darker grey) "color-node-self-name", "-box", and "-border" options

-   UPDATE [infr]: upgrade the "zod", "eslint", "typescript-eslint", "@types/node", "@rse/stx",
    and "vite" dependencies to their latest versions

-   CLEANUP [code]: clean up the renderer, diagram-type, and CLI/MCP source modules with
    clarifying comments, aligned formatting, and removal of dead code branches

1.2.3 (2026-09-09)
------------------

-   IMPROVEMENT [code, othr]: let the container boxes nested into a "grid" keep the height of
    their own content, as they took part in the tile height unification and hence all grew to
    the height of the largest one, and let each row become only as tall as its own tallest tile

-   FEATURE [code, othr]: support the new boolean "grid-node-height-equal" option (default
    "true"), the counterpart of "grid-node-width-equal" for the tile heights

1.2.2 (2026-09-09)
------------------

-   IMPROVEMENT [code, othr]: let an edge crossing a "graph" container boundary, which has to
    detour through a gutter around the nodes between its inner node and the border, pass the
    border at the height of that gutter, as it climbed back into the row of its boundary gate
    before and then dropped again outside, where its target usually lies at another height

-   IMPROVEMENT [othr]: re-render the "container-sample" SVG diagram

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

