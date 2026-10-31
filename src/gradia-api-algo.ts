/*
**  Gradia -- Object Graph Diagram Rendering
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Distributed under MIT license <https://spdx.org/licenses/MIT.html>
*/

/*  determine the strongly connected components of a directed graph of
    the given successors (with the algorithm of Tarjan, iteratively, as
    the graph can be deep), as the component index of every vertex  */
export const componentsOf = (succ: number[][]): number[] => {
    const n     = succ.length
    const index = new Array<number>(n).fill(-1)
    const low   = new Array<number>(n).fill(0)
    const comp  = new Array<number>(n).fill(-1)
    const stack: number[] = []
    let counter = 0
    let comps   = 0
    for (let s = 0; s < n; s++) {
        if (index[s] !== -1)
            continue
        index[s] = low[s] = counter++
        stack.push(s)
        const work: [ number, number ][] = [ [ s, 0 ] ]
        while (work.length > 0) {
            const top = work[work.length - 1]
            const v   = top[0]
            if (top[1] < succ[v].length) {
                const w = succ[v][top[1]++]
                if (index[w] === -1) {
                    index[w] = low[w] = counter++
                    stack.push(w)
                    work.push([ w, 0 ])
                }
                else if (comp[w] === -1)
                    low[v] = Math.min(low[v], index[w])
                continue
            }
            work.pop()
            const parent = work.at(-1)
            if (parent !== undefined)
                low[parent[0]] = Math.min(low[parent[0]], low[v])
            if (low[v] === index[v]) {
                let w: number
                do {
                    w = stack.pop()!
                    comp[w] = comps
                } while (w !== v)
                comps++
            }
        }
    }
    return comp
}

