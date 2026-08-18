/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  internal dependencies  */
import { Attr, Graph } from "./gradia-api-model.js"

/*  the token stream elements  */
interface Token {
    type:   "word" | "string" | "edge" | "punct" | "newline"
    text:   string
    name?:  string
    arity?: string
    line:   number
    col:    number
}

/*  tokenize the graph description language  */
const tokenize = (input: string): Token[] => {
    const tokens: Token[] = []
    let line = 1
    let col  = 1
    let i    = 0

    /*  reusable regular expressions  */
    const reEdge   = /--(?:\((?:"((?:[^"\\\n]|\\.)*)"|([^()"\s]+))\)--)?>(?:\[(?:"((?:[^"\\\n]|\\.)*)"|([^[\]"\s]+))\])?/y
    const reString = /"((?:[^"\\\n]|\\.)*)"/y
    const reWord   = /(?:(?!--)[^\s[\](),:">#])+/y

    /*  helper functions  */
    const match   = (re: RegExp): RegExpExecArray | null => {
        re.lastIndex = i
        return re.exec(input)
    }
    const unquote = (s: string) =>
        s.replace(/\\(.)/g, "$1")

    /*  iterate over input  */
    while (i < input.length) {
        const ch = input[i]
        let m: RegExpExecArray | null

        /*  whitespace, line breaks, and comments  */
        if (ch === "\n") {
            tokens.push({ type: "newline", text: "\n", line, col })
            line++
            col = 1
            i++
        }
        else if (ch === " " || ch === "\t" || ch === "\r") {
            col++
            i++
        }
        else if (ch === "#") {
            while (i < input.length && input[i] !== "\n") {
                col++
                i++
            }
        }

        /*  edge operators, quoted strings, punctuation, and barewords  */
        else if ((m = match(reEdge)) !== null) {
            const name:  string | undefined = m[1] !== undefined ? unquote(m[1]) : m[2]
            const arity: string | undefined = m[3] !== undefined ? unquote(m[3]) : m[4]
            tokens.push({ type: "edge", text: m[0], name, arity, line, col })
            col += m[0].length
            i   += m[0].length
        }
        else if ((m = match(reString)) !== null) {
            tokens.push({ type: "string", text: unquote(m[1]), line, col })
            col += m[0].length
            i   += m[0].length
        }
        else if (ch === "\"")
            throw new Error(`unterminated string at line ${line}, column ${col}`)
        else if ("[](),:".includes(ch)) {
            tokens.push({ type: "punct", text: ch, line, col })
            col++
            i++
        }
        else if ((m = match(reWord)) !== null) {
            tokens.push({ type: "word", text: m[0], line, col })
            col += m[0].length
            i   += m[0].length
        }
        else
            throw new Error(`invalid character ${JSON.stringify(ch)} at line ${line}, column ${col}`)
    }
    return tokens
}

/*  parse the token stream into the graph model  */
export const parse = (input: string): Graph => {
    const tokens = tokenize(input)
    const graph: Graph = { nodes: new Map(), edges: [] }
    let pos = 0

    /*  helper functions  */
    const peek   = () =>
        pos < tokens.length ? tokens[pos] : null
    const accept = (text: string): boolean => {
        const t = peek()
        if (t === null || t.type !== "punct" || t.text !== text)
            return false
        pos++
        return true
    }
    const bail   = (what: string): never => {
        const t = peek()
        const loc = t !== null ? `line ${t.line}, column ${t.col}` : "end of input"
        throw new Error(`expected ${what} at ${loc}`)
    }

    /*  parse a single atom (bareword or quoted string)  */
    const parseAtom = (): string => {
        const t = peek()
        if (t === null || (t.type !== "word" && t.type !== "string"))
            return bail("bareword or quoted string")
        pos++
        return t.text
    }

    /*  parse a node reference with optional label and attributes,
        merging the information into the already known node (if any)  */
    const parseNodeRef = (): string => {
        const start = tokens[pos]
        const id    = parseAtom()

        /*  parse the optional node label  */
        let name: string | null = null
        if (accept(":"))
            name = parseAtom()

        /*  parse the optional node attributes  */
        const attrs: Attr[] = []
        if (accept("[")) {
            while (true) {
                const key = parseAtom()
                if (!accept(":"))
                    bail("\":\" in key/value attribute")
                const val = parseAtom()
                attrs.push({ key, val })
                if (!accept(","))
                    break
            }
            if (!accept("]"))
                bail("\"]\" after key/value attributes")
        }

        /*  merge the parsed information into the graph node  */
        const node = graph.nodes.get(id) ?? { id, name: id, attrs: [] }
        if (name !== null)
            node.name = name
        for (const attr of attrs) {
            const k = node.attrs.findIndex((a) => a.key === attr.key)
            if (k === -1)
                node.attrs.push(attr)
            else {
                /*  a node has to stay in a single group, so reject any
                    attempt to re-assign it to a different group  */
                if (attr.key === "group" && node.attrs[k].val !== attr.val)
                    throw new Error(`node "${id}" cannot be member of more than one group ` +
                        `("${node.attrs[k].val}" vs "${attr.val}") ` +
                        `at line ${start.line}, column ${start.col}`)
                node.attrs[k] = attr
            }
        }
        graph.nodes.set(id, node)
        return id
    }

    /*  parse the statements (one node/edge chain per line)  */
    while (pos < tokens.length) {
        if (tokens[pos].type === "newline") {
            pos++
            continue
        }
        let source = parseNodeRef()
        let t = peek()
        while (t !== null && t.type === "edge") {
            pos++
            const target = parseNodeRef()
            graph.edges.push({ source, target, name: t.name, arity: t.arity })
            source = target
            t = peek()
        }
        if (t !== null && t.type !== "newline")
            bail("edge operator or end of line")
    }
    return graph
}

