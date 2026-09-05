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

/*  a directed graph edge with optional name and arity  */
export interface Edge {
    source: string
    target: string
    name?:  string
    arity?: string
}

/*  the graph model of nodes (keyed by their id) and edges  */
export interface Graph {
    nodes:  Map<string, Node>
    edges:  Edge[]
}

