/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  a node attribute as a key/value pair  */
export interface Attr {
    key:    string
    val:    string
}

/*  a graph node with its label and attributes  */
export interface Node {
    id:     string
    name:   string
    attrs:  Attr[]
}

/*  the kinds of an edge, i.e., of a message in a "sequence" diagram
    (a synchronous call, an asynchronous message, a return, or the
    creation or destruction of its receiver), or of an arc in a "petri"
    diagram (an inhibitor arc)  */
export const edgeKinds = [ "sync", "async", "return", "create", "destroy", "inhibitor" ] as const
export type EdgeKind = typeof edgeKinds[number]

/*  the types of an edge, i.e., of a dependency in a "gantt" diagram
    (finish-to-start, start-to-start, finish-to-finish, or start-to-finish)  */
export const edgeTypes = [ "fs", "ss", "ff", "sf" ] as const
export type EdgeType = typeof edgeTypes[number]

/*  a directed graph edge with optional name, arity, kind, type, and
    timing (a duration constraint up to its return and a time constraint
    or observation at its start, in a "sequence" diagram, or the lag of a
    dependency, in a "gantt" diagram), and its optional marking as a
    violation (e.g. by the analysis of a "state" diagram)  */
export interface Edge {
    source:    string
    target:    string
    name?:     string
    arity?:    string
    kind?:     EdgeKind
    type?:     EdgeType
    duration?: string
    time?:     string
    marked?:   boolean
}

/*  the graph model of nodes (keyed by their id) and edges  */
export interface Graph {
    nodes:  Map<string, Node>
    edges:  Edge[]
}

