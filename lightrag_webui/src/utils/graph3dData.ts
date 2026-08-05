import { resolveNodeColor, DEFAULT_NODE_COLOR } from '@/utils/graphColor'
import type { LightragGraphType } from '@/api/lightrag'
import type { RawGraph, Graph3DData, Graph3DNode, Graph3DLink } from '@/stores/graph'

// Parse an edge's `weight` property into a finite number, preserving a
// legitimate 0. `Number(x) || 1` would coerce a real weight of 0 (the thinnest
// edge) to 1; use a finite check so 0 survives and only undefined/NaN fall back.
const parseEdgeWeight = (properties: Record<string, unknown> | undefined): number => {
  const w = Number(properties?.weight)
  return Number.isFinite(w) ? w : 1
}

// Build a node label defensively: a malformed payload node missing its
// `labels` array must not throw (labels.join) and abort the whole graph build
// — fall back to the node id so the rest of the graph still renders.
const safeNodeLabel = (labels: unknown, fallbackId: string): string =>
  Array.isArray(labels) ? labels.join(', ') : fallbackId

// A type-color resolver that accumulates distinct entity_type → color mappings
// and commits them to the store in a single write (keeps the Legend functional).
// Mirrors the pattern in useLightragGraph's createTypeColorResolver.
const createTypeColorResolver = () => {
  let typeColorMap = new Map<string, string>()
  const cache = new Map<string, string>()

  return {
    colorFor(entityType: string | undefined): string {
      const key = entityType ?? ''
      let color = cache.get(key)
      if (color === undefined) {
        const resolved = resolveNodeColor(entityType, typeColorMap)
        if (resolved.updated) {
          typeColorMap = resolved.map
        }
        color = resolved.color || DEFAULT_NODE_COLOR
        cache.set(key, color)
      }
      return color
    },
    getMap(): Map<string, string> {
      return typeColorMap
    }
  }
}

// Convert the raw graph (from GET /graphs response or store.rawGraph) into the
// react-force-graph 3D format { nodes, links }. Node colors come from
// resolveNodeColor (by entity_type), val (size) from the pre-computed node.size
// (already degree-normalized by fetchGraph), and link width from edge weight.
//
// NOTE: this does NOT set x/y/z — react-force-graph initializes new nodes at a
// spherical random position and d3-force-3d springs them into place. Existing
// nodes' coordinates are preserved by diffIntoGraphData, not here.
export function rawGraphTo3DData(
  rawGraph: RawGraph | null,
  typeColorMap?: Map<string, string>
): { data: Graph3DData; updatedColorMap: Map<string, string> } {
  if (!rawGraph || !rawGraph.nodes.length) {
    return {
      data: { nodes: [], links: [] },
      updatedColorMap: typeColorMap ?? new Map()
    }
  }

  const resolver = createTypeColorResolver()

  const nodes: Graph3DNode[] = []
  for (let i = 0; i < rawGraph.nodes.length; i++) {
    const rawNode = rawGraph.nodes[i]
    const entityType = rawNode.properties?.entity_type as string | undefined
    const name = safeNodeLabel(rawNode.labels, rawNode.id)
    nodes.push({
      id: rawNode.id,
      name,
      label: name,
      color: resolver.colorFor(entityType),
      val: rawNode.size || 10,
      entity_type: entityType,
      properties: rawNode.properties
    })
  }

  const links: Graph3DLink[] = []
  if (rawGraph.edges) {
    for (let i = 0; i < rawGraph.edges.length; i++) {
      const rawEdge = rawGraph.edges[i]
      const keywords = rawEdge.properties?.keywords as string | undefined
      links.push({
        source: rawEdge.source,
        target: rawEdge.target,
        width: parseEdgeWeight(rawEdge.properties),
        label: keywords,
        properties: rawEdge.properties
      })
    }
  }

  return {
    data: { nodes, links },
    updatedColorMap: resolver.getMap()
  }
}

// Convert a GET /graphs API response directly into 3D format (without the
// degree-normalized `size` that RawGraph carries). Used by the incremental
// poller which works with the raw API response, not the store's RawGraph.
export function apiResponseTo3DData(
  response: LightragGraphType,
  typeColorMap?: Map<string, string>
): { data: Graph3DData; updatedColorMap: Map<string, string> } {
  if (!response || !response.nodes?.length) {
    return {
      data: { nodes: [], links: [] },
      updatedColorMap: typeColorMap ?? new Map()
    }
  }

  const resolver = createTypeColorResolver()

  // Compute degree for each node (API response doesn't carry it)
  const degreeMap = new Map<string, number>()
  for (const edge of response.edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1)
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1)
  }

  let minDegree = Number.MAX_SAFE_INTEGER
  let maxDegree = 0
  for (const deg of degreeMap.values()) {
    minDegree = Math.min(minDegree, deg)
    maxDegree = Math.max(maxDegree, deg)
  }
  const range = maxDegree - minDegree
  const minSize = 4
  const maxSize = 20

  const nodes: Graph3DNode[] = []
  for (const apiNode of response.nodes) {
    const entityType = apiNode.properties?.entity_type as string | undefined
    const name = safeNodeLabel(apiNode.labels, apiNode.id)
    const degree = degreeMap.get(apiNode.id) ?? 0
    const size = range > 0
      ? Math.round(minSize + (maxSize - minSize) * Math.pow((degree - minDegree) / range, 0.5))
      : minSize

    nodes.push({
      id: apiNode.id,
      name,
      label: name,
      color: resolver.colorFor(entityType),
      val: size,
      entity_type: entityType,
      properties: apiNode.properties
    })
  }

  const links: Graph3DLink[] = []
  for (const apiEdge of response.edges) {
    const keywords = apiEdge.properties?.keywords as string | undefined
    links.push({
      source: apiEdge.source,
      target: apiEdge.target,
      width: parseEdgeWeight(apiEdge.properties),
      label: keywords,
      properties: apiEdge.properties
    })
  }

  return {
    data: { nodes, links },
    updatedColorMap: resolver.getMap()
  }
}

// Diff a new API response against the known node/edge id sets and merge into
// the previous 3D data. Existing nodes keep their x/y/z/vx/vy/vz (and fx/fy/fz
// if the user dragged them) so d3-force-3d only nudges them when new nodes
// join; new nodes are added without coordinates so react-force-graph springs
// them into place from a spherical random init.
//
// Returns the merged data plus the count of newly added nodes/edges (the delta
// signal for the incremental build overlay).
export function diffIntoGraphData(
  prevData: Graph3DData,
  response: LightragGraphType,
  knownNodeIds: Set<string>,
  knownEdgeIds: Set<string>,
  typeColorMap?: Map<string, string>
): { merged: Graph3DData; newNodes: number; newEdges: number; updatedColorMap: Map<string, string> } {
  const resolver = createTypeColorResolver()
  // Seed the resolver with the existing color map so colors stay stable.
  if (typeColorMap) {
    for (const [k] of typeColorMap) {
      resolver.colorFor(k)
    }
  }

  // Index previous nodes by id for O(1) coordinate lookup.
  const prevNodeMap = new Map<string, Graph3DNode>()
  for (const n of prevData.nodes) {
    prevNodeMap.set(n.id, n)
  }

  // Start with all previous nodes (preserving their force-sim positions).
  const mergedNodes: Graph3DNode[] = [...prevData.nodes]
  let newNodes = 0

  // Compute degree from the full response for size normalization.
  const degreeMap = new Map<string, number>()
  for (const edge of response.edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1)
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1)
  }
  let minDegree = Number.MAX_SAFE_INTEGER
  let maxDegree = 0
  for (const deg of degreeMap.values()) {
    minDegree = Math.min(minDegree, deg)
    maxDegree = Math.max(maxDegree, deg)
  }
  const range = maxDegree - minDegree
  const minSize = 4
  const maxSize = 20

  // Process every node from the response — update existing, add new.
  for (const apiNode of response.nodes) {
    const entityType = apiNode.properties?.entity_type as string | undefined
    const color = resolver.colorFor(entityType)

    if (knownNodeIds.has(apiNode.id)) {
      // Update properties of existing node (description may have been merged)
      // but preserve force-sim position coordinates.
      const existing = prevNodeMap.get(apiNode.id)
      if (existing) {
        existing.properties = apiNode.properties
        existing.entity_type = entityType
        existing.color = color
        // Recompute val in case degree changed (new edges added)
        const degree = degreeMap.get(apiNode.id) ?? 0
        existing.val = range > 0
          ? Math.round(minSize + (maxSize - minSize) * Math.pow((degree - minDegree) / range, 0.5))
          : minSize
      }
    } else {
      const name = safeNodeLabel(apiNode.labels, apiNode.id)
      const degree = degreeMap.get(apiNode.id) ?? 0
      const size = range > 0
        ? Math.round(minSize + (maxSize - minSize) * Math.pow((degree - minDegree) / range, 0.5))
        : minSize
      // New node: no coordinates — react-force-graph will initialize it.
      mergedNodes.push({
        id: apiNode.id,
        name,
        label: name,
        color,
        val: size,
        entity_type: entityType,
        properties: apiNode.properties
      })
      knownNodeIds.add(apiNode.id)
      newNodes++
    }
  }

  // Merge edges: keep all previous links, add only new ones.
  const mergedLinks: Graph3DLink[] = [...prevData.links]
  let newEdges = 0
  for (const apiEdge of response.edges) {
    const edgeId = `${apiEdge.source}-${apiEdge.target}`
    if (knownEdgeIds.has(edgeId)) {
      // Update properties of existing edge (weight/keywords may have changed)
      const existing = mergedLinks.find(
        (l) =>
          (l.source === apiEdge.source && l.target === apiEdge.target) ||
          (typeof l.source === 'object' && (l.source as any)?.id === apiEdge.source && typeof l.target === 'object' && (l.target as any)?.id === apiEdge.target)
      )
      if (existing) {
        const keywords = apiEdge.properties?.keywords as string | undefined
        existing.properties = apiEdge.properties
        existing.label = keywords
        existing.width = parseEdgeWeight(apiEdge.properties)
      }
    } else {
      const keywords = apiEdge.properties?.keywords as string | undefined
      mergedLinks.push({
        source: apiEdge.source,
        target: apiEdge.target,
        width: parseEdgeWeight(apiEdge.properties),
        label: keywords,
        properties: apiEdge.properties
      })
      knownEdgeIds.add(edgeId)
      newEdges++
    }
  }

  return {
    merged: { nodes: mergedNodes, links: mergedLinks },
    newNodes,
    newEdges,
    updatedColorMap: resolver.getMap()
  }
}

// Initialize the known-id sets from an existing 3D dataset (e.g. when the
// incremental poller starts after a static full load).
export function initKnownIds(data: Graph3DData): {
  nodeIds: Set<string>
  edgeIds: Set<string>
} {
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  for (const n of data.nodes) {
    nodeIds.add(n.id)
  }
  for (const l of data.links) {
    const src = typeof l.source === 'object' ? (l.source as any)?.id : l.source
    const tgt = typeof l.target === 'object' ? (l.target as any)?.id : l.target
    if (src && tgt) {
      edgeIds.add(`${src}-${tgt}`)
    }
  }
  return { nodeIds, edgeIds }
}
