/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Edge, Graph }              from "./gradia-api-model.js"
import { Config }                   from "./gradia-api-config.js"
import { Layout, Poly }             from "./gradia-api-render-base.js"
import { Shape, pathShape }         from "./gradia-api-render-shape.js"
import { LevelContext, rejectContainers }
    from "./gradia-api-render-container.js"
import { measureNodes, orderOf }    from "./gradia-api-render-node.js"
import { simplifyPoly }             from "./gradia-api-render-edge.js"

/*  the geometry of the stacked leaves, the cross links, and the self-loops  */
const BUS_AT     = 0.67 /*  position of a bus in the level gap, from its far end      */
const STACK_IN   = 24   /*  offset of a stack trunk from the start of its parent box  */
const STACK_OUT  = 40   /*  offset of the stacked boxes from their stack trunk        */
const LINK_ROOM  = 28   /*  room of the first cross link track in front of a level    */
const LINK_TRACK = 8    /*  distance between two cross link tracks                    */
const LINK_LANE  = 12   /*  distance between two cross link lanes beside the tree     */
const LOOP_W     = 28   /*  width of a self-loop beside its box                       */
const LOOP_H     = 12   /*  half height of a self-loop                                */

/*  an occupied rectangle of a subtree: its extent along the main axis
    (along the levels) and along the cross axis (along the siblings)  */
type Rect = [ number, number, number, number ]

/*  a laid out subtree: its occupied rectangles, the cross axis center of
    every one of its nodes, and the cross axis position of the trunk of
    every one of its stacks (keyed by their parent), all relative to the
    subtree  */
interface Subtree {
    rects:  Rect[]
    center: Map<string, number>
    trunk:  Map<string, number>
}

/*  shift a subtree along the cross axis  */
const shift = (tree: Subtree, d: number): Subtree => ({
    rects:  tree.rects.map(([ m0, m1, c0, c1 ]): Rect => [ m0, m1, c0 + d, c1 + d ]),
    center: new Map(Array.from(tree.center, ([ id, c ]) => [ id, c + d ])),
    trunk:  new Map(Array.from(tree.trunk,  ([ id, c ]) => [ id, c + d ]))
})

/*  place subtrees side by side, each one as close to the previous ones
    as the gap between all of their rectangles overlapping along the main
    axis allows (the "tidy tree" packing along the subtree contours)  */
const pack = (list: Subtree[], gap: number): Subtree[] => {
    const placed: Subtree[] = []
    const rects:  Rect[]    = []
    for (const tree of list) {
        let d = -Infinity
        for (const [ m0, m1, c0 ] of tree.rects)
            for (const [ n0, n1, , e1 ] of rects)
                if (m0 < n1 && n0 < m1)
                    d = Math.max(d, e1 + gap - c0)
        if (!Number.isFinite(d) && rects.length > 0)
            d = Math.max(...rects.map((r) => r[3])) + gap - Math.min(...tree.rects.map((r) => r[2]))
        const moved = shift(tree, Number.isFinite(d) ? d : 0)
        placed.push(moved)
        rects.push(...moved.rects)
    }
    return placed
}

/*  lay out a graph model as a tree: the edges point from the parents to
    their children, the nodes without a parent are the roots of a forest,
    and every edge not fitting the tree (a second edge into a node, an
    edge closing a cycle, or a self-loop) is a cross link, drawn dashed
    (and marked as a violation). The levels stack top-down (or, with the
    option "tree-horizontal", left-to-right), every parent connects to
    its children through a bus, and the leaf children of a parent are
    stacked along a trunk, once there are "tree-stack-min" of them or
    their level holds more than "tree-row-max" nodes  */
export const render = async (graph: Graph, config: Config, level: LevelContext = {}): Promise<Layout> => {
    /*  determine the nodes in their order and ensure the graph carries
        no containers, as the tree is the only nesting  */
    const nodes = Array.from(graph.nodes.values())
        .sort((a, b) => (orderOf(a) ?? Infinity) - (orderOf(b) ?? Infinity) || 0)
    rejectContainers("tree", nodes, level)
    const rank = new Map(nodes.map((node, i) => [ node.id, i ]))

    /*  determine the tree edges in declaration order (the first edge into
        a node, unless it closes a cycle) and the remaining cross links  */
    const parentOf   = new Map<string, string>()
    const isAncestor = (a: string, b: string): boolean => {
        for (let id: string | undefined = b; id !== undefined; id = parentOf.get(id))
            if (id === a)
                return true
        return false
    }
    const cross = graph.edges.map((edge) => {
        if (edge.source === edge.target || parentOf.has(edge.target) || isAncestor(edge.target, edge.source))
            return true
        parentOf.set(edge.target, edge.source)
        return false
    })
    const children = new Map(nodes.map((node) => [ node.id, new Array<string>() ]))
    for (const [ child, parent ] of parentOf)
        children.get(parent)!.push(child)
    for (const list of children.values())
        list.sort((a, b) => rank.get(a)! - rank.get(b)!)
    const roots = nodes.filter((node) => !parentOf.has(node.id)).map((node) => node.id)
    const depth = new Map<string, number>()
    const visit = (id: string, d: number): void => {
        depth.set(id, d)
        for (const child of children.get(id)!)
            visit(child, d + 1)
    }
    roots.forEach((id) => visit(id, 0))
    const isLeaf = (id: string) => children.get(id)!.length === 0

    /*  measure the node boxes (optionally unified onto the width of the
        widest box of their level) and resolve the axes: the main axis runs
        along the levels, the cross axis along the siblings  */
    const { boxW, boxH, contentH } = measureNodes(nodes, config, () => config["size-node-height-scale"] / 2)
    if (config["tree-node-width-equal"]) {
        const widest = new Map<number, number>()
        for (const node of nodes)
            widest.set(depth.get(node.id)!, Math.max(widest.get(depth.get(node.id)!) ?? 0, boxW.get(node.id)!))
        for (const node of nodes)
            boxW.set(node.id, widest.get(depth.get(node.id)!)!)
    }
    const horizontal = config["tree-horizontal"]
    const levelGap   = config["tree-level-gap"]
    const siblingGap = config["tree-sibling-gap"]
    const margin     = config["size-canvas-margin"]
    const mainOf     = (id: string) => horizontal ? boxW.get(id)! : boxH.get(id)!
    const crossOf    = (id: string) => horizontal ? boxH.get(id)! : boxW.get(id)!

    /*  stack the leaf children of a parent, as soon as it has at least the
        configured minimum of them, or their level holds more than the
        configured maximum of nodes: below the parent along a trunk out of
        its box, if all of its children are stacked ("pure" stack), or
        else along a trunk out of its bus, at the position of the first
        stacked leaf among its other children, either on one side of the
        trunk only, or alternately on both of its sides  */
    const stackMin = Math.floor(config["tree-stack-min"])
    const rowMax   = Math.floor(config["tree-row-max"])
    const double   = config["tree-stack-double"]
    const count    = new Map<number, number>()
    for (const d of depth.values())
        count.set(d, (count.get(d) ?? 0) + 1)
    const stackOf  = new Map<string, string[]>()
    for (const node of nodes) {
        const leaves = children.get(node.id)!.filter(isLeaf)
        if (leaves.length > 0 && ((stackMin > 0 && leaves.length >= stackMin)
            || (rowMax > 0 && (count.get(depth.get(node.id)! + 1) ?? 0) > rowMax)))
            stackOf.set(node.id, leaves)
    }
    const pure    = (id: string) => (stackOf.get(id)?.length ?? 0) === children.get(id)!.length
    const inStack = (id: string) => parentOf.has(id) && (stackOf.get(parentOf.get(id)!)?.includes(id) ?? false)
    const sideOf  = new Map<string, number>()
    for (const list of stackOf.values())
        list.forEach((id, i) => sideOf.set(id, double && i % 2 === 0 ? -1 : 1))

    /*  the number of cross links attaching to the stacked nodes on either
        side of the trunk of a stack, which reserves a corridor beside it,
        with an own track for every one of them  */
    const linked = new Map<string, number>()
    const sideKey = (parent: string, side: number) => `${side}:${parent}`
    graph.edges.forEach((edge, i) => {
        if (cross[i] && edge.source !== edge.target)
            for (const id of [ edge.source, edge.target ])
                if (inStack(id)) {
                    const key = sideKey(parentOf.get(id)!, sideOf.get(id)!)
                    linked.set(key, (linked.get(key) ?? 0) + 1)
                }
    })
    const corridorRoom = (parent: string, side: number) => {
        const n = linked.get(sideKey(parent, side)) ?? 0
        return n > 0 ? LINK_ROOM + (n - 1) * LINK_TRACK : 0
    }

    /*  size the levels by their highest boxes (the stacked ones aside),
        space them by the level gap (or, in front of a level of stacked
        boxes only, which needs no bus, by the sibling gap), give the
        gutter in front of a level the additional room of the tracks of
        the cross links attaching to its nodes there, and align the boxes
        of a level at its start (for optical reasons), while the stacked
        boxes follow each other (one by one, or pairwise on both sides of
        the trunk) along their trunk, starting at the level of their own  */
    const rows    = Math.max(0, ...depth.values()) + 1
    const rowSize = Array.from({ length: rows + 1 }, () => 0)
    for (const node of nodes)
        if (!inStack(node.id))
            rowSize[depth.get(node.id)!] = Math.max(rowSize[depth.get(node.id)!], mainOf(node.id))
    const links = Array.from({ length: rows + 1 }, () => 0)
    graph.edges.forEach((edge, i) => {
        if (!cross[i] || edge.source === edge.target)
            return
        const [ ds, dt ] = [ depth.get(edge.source)!, depth.get(edge.target)! ]
        links[ds]++
        if (dt !== ds)
            links[dt]++
    })
    const extra  = links.map((n) => n > 0 ? LINK_ROOM + (n - 1) * LINK_TRACK : 0)
    const rowTop: number[] = []
    const mainC  = new Map<string, number>()
    let m      = margin + extra[0]
    let bottom = -Infinity
    rowSize.forEach((size, d) => {
        /*  a level whose gutter carries cross link tracks starts below all
            stacks hanging down from the levels above, so its tracks can run
            across the whole tree without crossing a stacked box  */
        if (links[d] > 0)
            m = Math.max(m, bottom + levelGap + extra[d])
        rowTop.push(m)
        for (const node of nodes)
            if (depth.get(node.id) === d && !inStack(node.id))
                mainC.set(node.id, m + mainOf(node.id) / 2)
        for (const [ id, list ] of stackOf) {
            if (depth.get(id)! + 1 !== d)
                continue
            let s = m
            for (let i = 0; i < list.length; i += double ? 2 : 1) {
                const slot = list.slice(i, i + (double ? 2 : 1))
                for (const leaf of slot)
                    mainC.set(leaf, s + mainOf(leaf) / 2)
                s += Math.max(...slot.map((leaf) => mainOf(leaf))) + siblingGap
            }
            bottom = Math.max(bottom, s - siblingGap)
        }
        m += size + (rowSize[d + 1] === 0 ? siblingGap : levelGap) + (extra[d + 1] ?? 0)
    })
    const m0Of     = (id: string) => mainC.get(id)! - mainOf(id) / 2
    const m1Of     = (id: string) => mainC.get(id)! + mainOf(id) / 2
    const busOf    = (id: string) => rowTop[depth.get(id)! + 1] - extra[depth.get(id)! + 1] - levelGap * BUS_AT
    const stackEnd = (id: string) => Math.max(...stackOf.get(id)!.map((leaf) => mainC.get(leaf)!))
    const reach    = (id: string, side: number) => STACK_OUT + Math.max(0,
        ...stackOf.get(id)!.filter((leaf) => sideOf.get(leaf) === side).map((leaf) => crossOf(leaf)))

    /*  lay out the stack of a parent around its trunk at the given cross
        axis position: the trunk from the given main axis position on, the
        leaves on their sides of it, and the corridors of its cross links
        beside it, from the gutter in front of the stack on  */
    const stackTree = (id: string, trunk: number, from: number): Subtree => {
        const list  = stackOf.get(id)!
        const rects: Rect[] = [ [ from, stackEnd(id), trunk - 1, trunk + 1 ] ]
        const center = new Map<string, number>()
        for (const leaf of list) {
            const s = sideOf.get(leaf)!
            const [ c0, c1 ] = s > 0 ? [ trunk, trunk + STACK_OUT + crossOf(leaf) ] :
                [ trunk - STACK_OUT - crossOf(leaf), trunk ]
            rects.push([ m0Of(leaf), m1Of(leaf), c0, c1 ])
            center.set(leaf, s > 0 ? c1 - crossOf(leaf) / 2 : c0 + crossOf(leaf) / 2)
        }
        const d   = depth.get(id)! + 1
        const end = Math.max(...list.map((leaf) => m1Of(leaf)))
        if (corridorRoom(id, 1) > 0)
            rects.push([ rowTop[d] - extra[d], end, trunk + reach(id, 1), trunk + reach(id, 1) + corridorRoom(id, 1) ])
        if (corridorRoom(id, -1) > 0)
            rects.push([ rowTop[d] - extra[d], end, trunk - reach(id, -1) - corridorRoom(id, -1), trunk - reach(id, -1) ])
        return { rects, center, trunk: new Map([ [ id, trunk ] ]) }
    }

    /*  lay out every subtree bottom-up: a leaf as its box, a parent with a
        pure stack as its box with the stack below it (its trunk near its
        start, or, with stacks on both sides, at its center), and any other
        parent centered on its bus over its packed child subtrees (its
        stack, if any, as one of them, hanging off the bus at its trunk)  */
    const layoutOf = (id: string): Subtree => {
        const list = children.get(id)!
        const cs   = crossOf(id)
        if (list.length === 0)
            return { rects: [ [ m0Of(id), m1Of(id), 0, cs ] ], center: new Map([ [ id, cs / 2 ] ]), trunk: new Map() }
        if (pure(id)) {
            const tree = stackTree(id, double ? cs / 2 : STACK_IN, m1Of(id))
            tree.rects.push([ m0Of(id), m1Of(id), 0, cs ])
            tree.center.set(id, cs / 2)
            return tree
        }
        const items: { tree: Subtree, at: (tree: Subtree) => number }[] = []
        for (const child of list) {
            if (!inStack(child))
                items.push({ tree: layoutOf(child), at: (tree) => tree.center.get(child)! })
            else if (child === stackOf.get(id)![0])
                items.push({ tree: stackTree(id, 0, busOf(id)), at: (tree) => tree.trunk.get(id)! })
        }
        const subs  = pack(items.map((item) => item.tree), siblingGap)
        const first = items[0].at(subs[0])
        const last  = items[items.length - 1].at(subs[subs.length - 1])
        const pc    = (first + last) / 2
        const rects = subs.flatMap((sub) => sub.rects)
        rects.push([ m0Of(id), m1Of(id), pc - cs / 2, pc + cs / 2 ],
            [ m1Of(id), rowTop[depth.get(id)! + 1], Math.min(first, pc), Math.max(last, pc) ])
        return { rects,
            center: new Map([ ...subs.flatMap((sub) => Array.from(sub.center)), [ id, pc ] ]),
            trunk:  new Map(subs.flatMap((sub) => Array.from(sub.trunk))) }
    }

    /*  place the trees of the forest side by side, flush to the margin  */
    const forest = pack(roots.map(layoutOf), siblingGap)
    const center = new Map(forest.flatMap((tree) => Array.from(tree.center)))
    const trunks = new Map(forest.flatMap((tree) => Array.from(tree.trunk)))
    const starts = forest.flatMap((tree) => tree.rects.map((r) => r[2]))
    const minC   = starts.length > 0 ? Math.min(...starts) : 0
    const crossC = (id: string) => margin + center.get(id)! - minC
    const trunkC = (id: string) => margin + trunks.get(id)! - minC
    const pt     = (main: number, crs: number): [ number, number ] => horizontal ? [ main, crs ] : [ crs, main ]
    const cx     = (id: string) => pt(mainC.get(id)!, crossC(id))[0]
    const cy     = (id: string) => pt(mainC.get(id)!, crossC(id))[1]

    /*  connect every parent with its children: through a bus (a trunk out
        of the parent box end and a bar across the children, both drawn as
        shapes, with the drops from the bar into the children as the edges),
        a single child directly by its edge, and stacked children through
        a trunk along the stack (out of the parent box end, or out of the
        bus), from which their edges branch off into their inner sides  */
    const shapes: Shape[] = []
    const line = ([ x1, y1 ]: [ number, number ], [ x2, y2 ]: [ number, number ]) => {
        const [ dx, dy ] = [ x2 - x1, y2 - y1 ]
        shapes.push(pathShape(x1, y1, `l ${dx} ${dy}`, [ Math.min(0, dx), Math.min(0, dy), Math.max(0, dx),
            Math.max(0, dy) ], "color-edge-line", 3))
    }
    const viaOf = new Map<string, Poly>()
    const stackVia = (id: string, from: number) => {
        const trunk = trunkC(id)
        line(pt(from, trunk), pt(stackEnd(id), trunk))
        for (const leaf of stackOf.get(id)!)
            viaOf.set(leaf, [ pt(mainC.get(leaf)!, trunk),
                pt(mainC.get(leaf)!, crossC(leaf) - sideOf.get(leaf)! * crossOf(leaf) / 2) ])
    }
    for (const node of nodes) {
        const list = children.get(node.id)!
        if (list.length === 0)
            continue
        const pc   = crossC(node.id)
        const pEnd = m1Of(node.id)
        if (pure(node.id)) {
            stackVia(node.id, pEnd)
            continue
        }
        const bus     = busOf(node.id)
        const drops   = list.filter((child) => !inStack(child))
        const anchors = [ ...drops.map((child) => crossC(child)), ...(stackOf.has(node.id) ? [ trunkC(node.id) ] : []) ]
        if (anchors.length === 1) {
            const cc = crossC(drops[0])
            viaOf.set(drops[0], simplifyPoly([ pt(pEnd, pc), pt(bus, pc), pt(bus, cc), pt(m0Of(drops[0]), cc) ]))
            continue
        }
        line(pt(pEnd, pc), pt(bus, pc))
        line(pt(bus, Math.min(pc, ...anchors)), pt(bus, Math.max(pc, ...anchors)))
        for (const child of drops)
            viaOf.set(child, [ pt(bus, crossC(child)), pt(m0Of(child), crossC(child)) ])
        if (stackOf.has(node.id))
            stackVia(node.id, bus)
    }

    /*  route every cross link through the gutters in front of the levels,
        on own tracks between the level and its bus: between two nodes of
        the same level (stacked or not) on one track directly through the
        gutter in front of it, and otherwise from the gutter in front of
        the level of its source out to an own lane beyond the nearer side
        of the tree, along it, and back into the gutter in front of the
        level of its target, so it never crosses a node box. A node in a
        level attaches off its center (towards the lane), clear of the drop
        of its tree edge, and a stacked node from its outer side through
        the corridor beside its stack (a self-loop is drawn beside the far
        side of its box)  */
    const far   = margin + Math.max(0, ...forest.flatMap((tree) => tree.rects.map((r) => r[3]))) - minC
    const taken = new Map<number, number>()
    const track = (id: string): number => {
        const d = depth.get(id)!
        const k = taken.get(d) ?? 0
        taken.set(d, k + 1)
        return rowTop[d] - LINK_ROOM - k * LINK_TRACK
    }
    const used   = new Map<string, number>()
    const attach = (id: string, lane: number, dir: number): Poly => {
        if (inStack(id)) {
            const [ p, s ] = [ parentOf.get(id)!, sideOf.get(id)! ]
            const k = used.get(sideKey(p, s)) ?? 0
            used.set(sideKey(p, s), k + 1)
            const [ edge, corridor ] = [ crossC(id) + s * crossOf(id) / 2,
                trunkC(p) + s * (reach(p, s) + LINK_ROOM + k * LINK_TRACK) ]
            return [ pt(mainC.get(id)!, edge), pt(mainC.get(id)!, corridor), pt(lane, corridor) ]
        }
        const x = crossC(id) + dir * crossOf(id) / 4
        return [ pt(m0Of(id), x), pt(lane, x) ]
    }
    const lanes = { near: 0, far: 0 }
    const crossPoly = (edge: Edge): Poly => {
        const [ s, t ] = [ edge.source, edge.target ]
        if (s === t) {
            const [ x, y ] = pt(mainC.get(s)!, crossC(s) + crossOf(s) / 2)
            return horizontal ?
                [ [ x - LOOP_H, y ], [ x - LOOP_H, y + LOOP_W ], [ x + LOOP_H, y + LOOP_W ], [ x + LOOP_H, y ] ] :
                [ [ x, y - LOOP_H ], [ x + LOOP_W, y - LOOP_H ], [ x + LOOP_W, y + LOOP_H ], [ x, y + LOOP_H ] ]
        }
        if (depth.get(s) === depth.get(t) && !inStack(s) && !inStack(t)) {
            const dir  = Math.sign(crossC(t) - crossC(s)) || 1
            const [ xs, xt ] = [ crossC(s) + dir * crossOf(s) / 4, crossC(t) - dir * crossOf(t) / 4 ]
            const lane = track(s)
            return [ pt(m0Of(s), xs), pt(lane, xs), pt(lane, xt), pt(m0Of(t), xt) ]
        }
        if (depth.get(s) === depth.get(t)) {
            const lane = track(s)
            const dir  = Math.sign(crossC(t) - crossC(s)) || 1
            return [ ...attach(s, lane, dir), ...attach(t, lane, -dir).reverse() ]
        }
        const near = (crossC(s) + crossC(t)) / 2 < (margin + far) / 2
        const dir  = near ? -1 : 1
        const [ ls, lt ] = [ track(s), track(t) ]
        const [ as, at ] = [ attach(s, ls, dir), attach(t, lt, dir) ]
        const outer = [ as, at ].map((p) => horizontal ? p[p.length - 1][1] : p[p.length - 1][0])
            .find((c) => near ? c <= margin + 1 : c >= far - 1)
        const side  = outer ?? (near ? margin - siblingGap - LINK_LANE * lanes.near++ : far + siblingGap + LINK_LANE * lanes.far++)
        return simplifyPoly([ ...as, pt(ls, side), pt(lt, side), ...at.reverse() ])
    }
    const polys = graph.edges.map((edge, i) => cross[i] ? crossPoly(edge) : viaOf.get(edge.target)!)

    /*  hand over the laid out tree, with its cross links drawn dashed and
        marked as violations (unless the marking of the violations is disabled)  */
    return { nodes, edges: graph.edges, cx, cy, boxW, boxH, contentH, polys, shapes,
        dashed: cross, marked: cross.map((c) => c && config["mark-violation"]) }
}
