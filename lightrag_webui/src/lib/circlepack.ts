/**
 * D3-hierarchy pack algorithm (circle packing) — self-contained port.
 *
 * Produces tightly-packed non-overlapping circle positions using the
 * front-chain sibling packing + Welzl smallest-enclosing-circle algorithm,
 * identical to d3-hierarchy's `pack()` and graphology-layout's circlepack.
 *
 * Used by the 3D / 2.5D Circlepack layout to match the 2D sigma circlepack.
 */

// --- LCG (deterministic random) for reproducible shuffle ---
function lcg() {
  const a = 1664525
  const c = 1013904223
  const m = 2 ** 32
  let s = 1
  return () => {
    s = (a * s + c) % m
    return s / m
  }
}

function shuffle<T>(arr: T[], random: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// --- Place circle c tangent to both a and b ---
function place(a: Circle, b: Circle, c: Circle) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d2 = dx * dx + dy * dy
  if (d2) {
    const a2 = (a.r + c.r) ** 2
    const b2 = (b.r + c.r) ** 2
    if (a2 > b2) {
      const x = (d2 + b2 - a2) / (2 * d2)
      const y = Math.sqrt(Math.max(0, b2 / d2 - x * x))
      c.x = b.x - x * dx - y * dy
      c.y = b.y - x * dy + y * dx
    } else {
      const x = (d2 + a2 - b2) / (2 * d2)
      const y = Math.sqrt(Math.max(0, a2 / d2 - x * x))
      c.x = a.x + x * dx - y * dy
      c.y = a.y + x * dy + y * dx
    }
  } else {
    c.x = a.x + c.r
    c.y = a.y
  }
}

function intersects(a: Circle, b: Circle) {
  const dr = a.r + b.r - 1e-6
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dr > 0 && dr * dr > dx * dx + dy * dy
}

interface Circle {
  x: number
  y: number
  r: number
}

interface ChainNode {
  _: Circle
  next: ChainNode | null
  previous: ChainNode | null
}

function score(a: ChainNode, b: ChainNode) {
  const ca = a._
  const cb = b._
  const ab = ca.r + cb.r
  const dx = (ca.x * cb.r + cb.x * ca.r) / ab
  const dy = (ca.y * cb.r + cb.y * ca.r) / ab
  return dx * dx + dy * dy
}

// --- Smallest enclosing circle (Welzl) ---

function enclosesNot(a: Circle, b: Circle) {
  const dr = a.r - b.r
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dr < 0 || dr * dr < dx * dx + dy * dy
}

function enclosesWeak(a: Circle, b: Circle) {
  const dr = a.r - b.r + Math.max(a.r, b.r, 1) * 1e-9
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dr > 0 && dr * dr > dx * dx + dy * dy
}

function enclosesWeakAll(a: Circle, B: Circle[]) {
  for (const b of B) {
    if (!enclosesWeak(a, b)) return false
  }
  return true
}

function encloseBasis1(a: Circle): Circle {
  return { x: a.x, y: a.y, r: a.r }
}

function encloseBasis2(a: Circle, b: Circle): Circle {
  const x21 = b.x - a.x
  const y21 = b.y - a.y
  const r21 = b.r - a.r
  const l = Math.sqrt(x21 * x21 + y21 * y21)
  return {
    x: (a.x + b.x + (x21 / l) * r21) / 2,
    y: (a.y + b.y + (y21 / l) * r21) / 2,
    r: (l + a.r + b.r) / 2
  }
}

function encloseBasis3(a: Circle, b: Circle, c: Circle): Circle {
  const x1 = a.x, y1 = a.y, r1 = a.r
  const x2 = b.x, y2 = b.y, r2 = b.r
  const x3 = c.x, y3 = c.y, r3 = c.r
  const a2 = x1 - x2
  const a3 = x1 - x3
  const b2 = y1 - y2
  const b3 = y1 - y3
  const c2 = r2 - r1
  const c3 = r3 - r1
  const d1 = x1 * x1 + y1 * y1 - r1 * r1
  const d2 = d1 - x2 * x2 - y2 * y2 + r2 * r2
  const d3 = d1 - x3 * x3 - y3 * y3 + r3 * r3
  const ab = a3 * b2 - a2 * b3
  const xa = (b2 * d3 - b3 * d2) / (ab * 2) - x1
  const xb = (b3 * c2 - b2 * c3) / ab
  const ya = (a3 * d2 - a2 * d3) / (ab * 2) - y1
  const yb = (a2 * c3 - a3 * c2) / ab
  const A = xb * xb + yb * yb - 1
  const B = 2 * (r1 + xa * xb + ya * yb)
  const C = xa * xa + ya * ya - r1 * r1
  const r = -(Math.abs(A) > 1e-6 ? (B + Math.sqrt(B * B - 4 * A * C)) / (2 * A) : C / B)
  return {
    x: x1 + xa + xb * r,
    y: y1 + ya + yb * r,
    r: r
  }
}

function encloseBasis(B: Circle[]): Circle {
  switch (B.length) {
    case 1: return encloseBasis1(B[0])
    case 2: return encloseBasis2(B[0], B[1])
    case 3: return encloseBasis3(B[0], B[1], B[2])
    default: return { x: 0, y: 0, r: 0 }
  }
}

function extendBasis(B: Circle[], p: Circle): Circle[] {
  if (enclosesWeakAll(p, B)) return [p]

  for (let i = 0; i < B.length; i++) {
    if (enclosesNot(p, B[i]) && enclosesWeakAll(encloseBasis2(B[i], p), B)) {
      return [B[i], p]
    }
  }

  for (let i = 0; i < B.length - 1; i++) {
    for (let j = i + 1; j < B.length; j++) {
      if (
        enclosesNot(encloseBasis2(B[i], B[j]), p) &&
        enclosesNot(encloseBasis2(B[i], p), B[j]) &&
        enclosesNot(encloseBasis2(B[j], p), B[i]) &&
        enclosesWeakAll(encloseBasis3(B[i], B[j], p), B)
      ) {
        return [B[i], B[j], p]
      }
    }
  }
  return B
}

function packEnclose(circles: Circle[]): Circle | null {
  if (circles.length === 0) return null
  const random = lcg()
  const shuffled = shuffle(circles, random)
  let B: Circle[] = []
  let e: Circle | null = null

  for (let i = 0; i < shuffled.length;) {
    const p = shuffled[i]
    if (e && enclosesWeak(e, p)) {
      i++
    } else {
      B = extendBasis(B, p)
      e = encloseBasis(B)
      i = 0
    }
  }
  return e
}

// --- Front-chain sibling packing ---
function packSiblings(circles: Circle[]): number {
  const n = circles.length
  if (n === 0) return 0
  const random = lcg()

  // Shuffle for deterministic variety (matches d3-hierarchy behavior)
  const arr = shuffle(circles, random)

  const a = arr[0]
  a.x = 0; a.y = 0
  if (n === 1) return a.r

  const b = arr[1]
  a.x = -b.r; b.x = a.r; b.y = 0
  if (n === 2) return a.r + b.r

  const c = arr[2]
  place(a, b, c)

  // Initialize front-chain: a -> c -> b -> a
  let na: ChainNode = { _: a, next: null, previous: null }
  let nb: ChainNode = { _: b, next: null, previous: null }
  const nc: ChainNode = { _: c, next: null, previous: null }
  na.next = nc; nc.previous = na
  nc.next = nb; nb.previous = nc
  nb.next = na; na.previous = nb

  for (let i = 3; i < n; i++) {
    const ci = arr[i]
    place(na._, nb._, ci)
    const newChainNode: ChainNode = { _: ci, next: null, previous: null }

    let j = nb.next!
    let k = na.previous!
    let sj = nb._.r
    let sk = na._.r
    let placed = false

    do {
      if (sj <= sk) {
        if (intersects(j._, newChainNode._)) {
          // b = j, move front-chain
          nb = j
          na.next = nb; nb.previous = na
          i--
          placed = true
          break
        }
        sj += j._.r
        j = j.next!
      } else {
        if (intersects(k._, newChainNode._)) {
          na = k
          na.next = nb; nb.previous = na
          i--
          placed = true
          break
        }
        sk += k._.r
        k = k.previous!
      }
    } while (j !== k.next)

    if (!placed) {
      // Insert between a and b
      newChainNode.previous = na
      newChainNode.next = nb
      na.next = newChainNode
      nb.previous = newChainNode
      nb = newChainNode

      // Find closest pair to centroid
      let bestScore = score(na, nb)
      let curr = nb.next!
      while (curr !== nb) {
        const s = score(curr.previous!, curr)
        if (s < bestScore) {
          na = curr
          bestScore = s
        }
        curr = curr.next!
      }
      nb = na.next!
    }
  }

  // Compute enclosing circle
  const chain: Circle[] = [nb._]
  let curr = nb
  while ((curr = curr.next!) !== nb) {
    chain.push(curr._)
  }
  const enc = packEnclose(chain)
  if (enc) {
    for (const cir of arr) {
      cir.x -= enc.x
      cir.y -= enc.y
    }
    return enc.r
  }
  return 0
}

export interface PackedNode {
  id: string
  x: number
  y: number
  r: number
}

export interface PackedCluster {
  x: number
  y: number
  r: number
  nodes: PackedNode[]
}

/**
 * Pack circles into a tight non-overlapping layout.
 *
 * Input: array of { id, r } objects (radius).
 * Output: same array with x, y set, plus the enclosing circle radius.
 *
 * This is a direct port of d3-hierarchy's packSiblings + packEnclose,
 * producing identical results to the 2D graphology circlepack.
 */
export function packCircles(
  items: { id: string; r: number }[]
): { items: PackedNode[]; enclosingRadius: number } {
  const circles: Circle[] = items.map((it) => ({
    x: 0,
    y: 0,
    r: it.r
  }))
  const enc = packSiblings(circles)
  const packed: PackedNode[] = items.map((it, i) => ({
    id: it.id,
    x: circles[i].x,
    y: circles[i].y,
    r: circles[i].r
  }))
  return { items: packed, enclosingRadius: enc }
}

/**
 * Multi-level circle packing: pack clusters, then pack nodes within clusters.
 * Matches d3-hierarchy's two-pass pack (packChildren at each level).
 */
export function packHierarchy(
  clusters: { id: string; nodes: { id: string; r: number }[] }[]
): PackedCluster[] {
  // Phase 1: pack nodes within each cluster
  const packedClusters = clusters.map((cluster) => {
    const { items, enclosingRadius } = packCircles(cluster.nodes)
    return {
      id: cluster.id,
      nodes: items,
      r: enclosingRadius
    }
  })

  // Phase 2: pack clusters themselves
  const clusterCircles: Circle[] = packedClusters.map((pc) => ({
    x: 0, y: 0, r: pc.r
  }))
  packSiblings(clusterCircles)

  // Translate nodes within each cluster by the cluster's offset
  const result: PackedCluster[] = []
  for (let i = 0; i < packedClusters.length; i++) {
    const offset = clusterCircles[i]
    result.push({
      x: offset.x,
      y: offset.y,
      r: offset.r,
      nodes: packedClusters[i].nodes.map((n) => ({
        id: n.id,
        x: n.x + offset.x,
        y: n.y + offset.y,
        r: n.r
      }))
    })
  }

  return result
}
