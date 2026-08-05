import { create } from 'zustand'
import { createSelectors } from '@/lib/utils'
import { DirectedGraph } from 'graphology'
import MiniSearch from 'minisearch'
import { resolveNodeColor, DEFAULT_NODE_COLOR } from '@/utils/graphColor'

// Minimal imperative handle the store needs to own a running layout: enough to
// terminate the previous one before a new layout takes over.
export interface LayoutSupervisorHandle {
  kill: () => void
}

const createErrorWithCause = (message: string, cause: unknown): Error => {
  const error = new Error(message) as Error & { cause?: unknown }
  error.cause = cause
  return error
}

// --- 3D force-graph data types (react-force-graph format) ---
export type Graph3DNode = {
  id: string
  name: string
  color: string
  val: number
  label?: string
  // d3-force-3d mutates these in place; carried over on diff to avoid re-layout
  x?: number
  y?: number
  z?: number
  vx?: number
  vy?: number
  vz?: number
  fx?: number
  fy?: number
  fz?: number
  // Original properties for PropertiesView (shared with 2D selection)
  properties?: Record<string, any>
  entity_type?: string
}

export type Graph3DLink = {
  source: string
  target: string
  color?: string
  width?: number
  label?: string
  properties?: Record<string, any>
}

export type Graph3DData = {
  nodes: Graph3DNode[]
  links: Graph3DLink[]
}

export type RawNodeType = {
  // for NetworkX: id is identical to properties['entity_id']
  // for Neo4j: id is unique identifier for each node
  id: string
  labels: string[]
  properties: Record<string, any>

  size: number
  x: number
  y: number
  color: string

  degree: number
}

export type RawEdgeType = {
  // for NetworkX: id is "source-target"
  // for Neo4j: id is unique identifier for each edge
  id: string
  source: string
  target: string
  type?: string
  properties: Record<string, any>
  // dynamicId: key for sigmaGraph
  dynamicId: string
}

/**
 * Interface for tracking edges that need updating when a node ID changes
 */
interface EdgeToUpdate {
  originalDynamicId: string
  newEdgeId: string
  edgeIndex: number
}

export class RawGraph {
  nodes: RawNodeType[] = []
  edges: RawEdgeType[] = []
  // nodeIDMap: map node id to index in nodes array (SigmaGraph has nodeId as key)
  nodeIdMap: Record<string, number> = {}
  // edgeIDMap: map edge id to index in edges array (SigmaGraph not use id as key)
  edgeIdMap: Record<string, number> = {}
  // edgeDynamicIdMap: map edge dynamic id to index in edges array (SigmaGraph has DynamicId as key)
  edgeDynamicIdMap: Record<string, number> = {}

  getNode = (nodeId: string) => {
    const nodeIndex = this.nodeIdMap[nodeId]
    if (nodeIndex !== undefined) {
      return this.nodes[nodeIndex]
    }
    return undefined
  }

  getEdge = (edgeId: string, dynamicId: boolean = true) => {
    const edgeIndex = dynamicId ? this.edgeDynamicIdMap[edgeId] : this.edgeIdMap[edgeId]
    if (edgeIndex !== undefined) {
      return this.edges[edgeIndex]
    }
    return undefined
  }

  buildDynamicMap = () => {
    // Null-prototype: dynamic ids are graph-generated, but keep this consistent
    // with the null-proto node/edge id maps so a missing-key lookup never
    // returns an inherited Object.prototype member.
    this.edgeDynamicIdMap = Object.create(null) as Record<string, number>
    for (let i = 0; i < this.edges.length; i++) {
      const edge = this.edges[i]
      this.edgeDynamicIdMap[edge.dynamicId] = i
    }
  }
}

interface GraphState {
  selectedNode: string | null
  focusedNode: string | null
  selectedEdge: string | null
  focusedEdge: string | null

  rawGraph: RawGraph | null
  sigmaGraph: DirectedGraph | null
  sigmaInstance: any | null

  // Reactive node/edge counts. The sigma graph is mutated in place by
  // expand/prune (no setSigmaGraph, no version bump), so `sigmaGraph.order` /
  // `.size` are NOT reactive in React. These mirror them and are the single
  // source of truth for: the status bar (SettingsDisplay) and the edge-count
  // adaptive behavior (curved vs straight edges, edge-event gating). Kept as a
  // store invariant — see setSigmaGraph/reset/setGraphCounts.
  graphNodeCount: number
  graphEdgeCount: number

  searchEngine: MiniSearch | null

  moveToSelectedNode: boolean
  isFetching: boolean
  graphIsEmpty: boolean
  lastSuccessfulQueryLabel: string

  typeColorMap: Map<string, string>

  // Global flags to track data fetching attempts
  graphDataFetchAttempted: boolean
  labelsFetchAttempted: boolean

  setSigmaInstance: (instance: any) => void
  setSelectedNode: (nodeId: string | null, moveToSelectedNode?: boolean) => void
  setFocusedNode: (nodeId: string | null) => void
  setSelectedEdge: (edgeId: string | null) => void
  setFocusedEdge: (edgeId: string | null) => void
  clearSelection: () => void
  reset: () => void

  setMoveToSelectedNode: (moveToSelectedNode: boolean) => void
  setGraphIsEmpty: (isEmpty: boolean) => void
  setLastSuccessfulQueryLabel: (label: string) => void

  setRawGraph: (rawGraph: RawGraph | null) => void
  setSigmaGraph: (sigmaGraph: DirectedGraph | null) => void
  // Update the reactive node/edge counts together (one set call → one notify).
  // Call after in-place mutations (expand/prune) and to override the synthetic
  // empty placeholder graph back to 0/0.
  setGraphCounts: (nodeCount: number, edgeCount: number) => void
  setIsFetching: (isFetching: boolean) => void

  // True while a layout (sync or worker) is computing. Drives the loading
  // overlay so a layout click doesn't look like a frozen UI on large graphs.
  isLayoutComputing: boolean
  setIsLayoutComputing: (running: boolean) => void

  // Single-owner handle for the running worker-layout supervisor. Only ONE
  // layout may run at a time: the initial FA2 (GraphControl) and a manually
  // selected worker layout (LayoutsControl) both register here. Registering a
  // new owner (or null) kills the previous supervisor first, so two layouts
  // never mutate the same node coordinates concurrently (the tug-of-war/jitter
  // bug). Not reactive — consumers read it via getState().
  activeLayoutSupervisor: LayoutSupervisorHandle | null
  setActiveLayoutSupervisor: (next: LayoutSupervisorHandle | null) => void
  // Release `handle` ONLY if it still owns the shared slot (clears it, which
  // kills it); otherwise just kill `handle` directly because a newer layout
  // already took the slot. Collapses the "release-if-owner-else-kill" dance
  // that consumers (GraphControl, LayoutsControl) would otherwise each repeat.
  releaseLayoutSupervisor: (handle: LayoutSupervisorHandle | null) => void

  // Legend color mapping methods
  setTypeColorMap: (typeColorMap: Map<string, string>) => void

  // Search engine methods
  setSearchEngine: (engine: MiniSearch | null) => void
  resetSearchEngine: () => void

  // Methods to set global flags
  setGraphDataFetchAttempted: (attempted: boolean) => void
  setLabelsFetchAttempted: (attempted: boolean) => void

  // Event trigger methods for node operations
  triggerNodeExpand: (nodeId: string | null) => void
  triggerNodePrune: (nodeId: string | null) => void

  // Node operation state
  nodeToExpand: string | null
  nodeToPrune: string | null

  // Version counter to trigger data refresh
  graphDataVersion: number
  incrementGraphDataVersion: () => void

  // --- 3D force-graph state ---
  // 3D data in react-force-graph format ({nodes, links}). Independent of
  // sigmaGraph; derived from rawGraph for static mode, from polling diffs for
  // incremental build mode. Node positions (x/y/z) are preserved across diffs
  // so d3-force-3d only nudges existing nodes and springs new ones into place.
  graph3DData: Graph3DData
  setGraph3DData: (data: Graph3DData) => void
  // Delta signal: only the newly added nodes/edges from the last poll tick.
  // ForceGraph3DContainer watches this to call fg.graphData() imperatively
  // (prop-driven updates reset the whole force simulation).
  graph3DDataDelta: { newNodes: number; newEdges: number } | null
  setGraph3DDataDelta: (delta: { newNodes: number; newEdges: number } | null) => void
  // True while the incremental build poller is actively polling GET /graphs.
  isIncrementalBuilding: boolean
  setIsIncrementalBuilding: (building: boolean) => void
  // latest_message from GET /documents/pipeline_status, shown in the overlay.
  incrementalMessage: string
  setIncrementalMessage: (msg: string) => void

  // Methods for updating graph elements and UI state together
  updateNodeAndSelect: (nodeId: string, entityId: string, propertyName: string, newValue: string) => Promise<void>
  updateEdgeAndSelect: (edgeId: string, dynamicId: string, sourceId: string, targetId: string, propertyName: string, newValue: string) => Promise<void>
}

const useGraphStoreBase = create<GraphState>()((set, get) => ({
  selectedNode: null,
  focusedNode: null,
  selectedEdge: null,
  focusedEdge: null,

  moveToSelectedNode: false,
  isFetching: false,
  graphIsEmpty: false,
  lastSuccessfulQueryLabel: '', // Initialize as empty to ensure fetchAllDatabaseLabels runs on first query

  // Initialize global flags
  graphDataFetchAttempted: false,
  labelsFetchAttempted: false,

  rawGraph: null,
  sigmaGraph: null,
  sigmaInstance: null,

  graphNodeCount: 0,
  graphEdgeCount: 0,

  typeColorMap: new Map<string, string>(),

  searchEngine: null,

  setGraphIsEmpty: (isEmpty: boolean) => set({ graphIsEmpty: isEmpty }),
  setLastSuccessfulQueryLabel: (label: string) => set({ lastSuccessfulQueryLabel: label }),


  setIsFetching: (isFetching: boolean) => set({ isFetching }),

  isLayoutComputing: false,
  setIsLayoutComputing: (running: boolean) => set({ isLayoutComputing: running }),

  activeLayoutSupervisor: null,
  setActiveLayoutSupervisor: (next: LayoutSupervisorHandle | null) => {
    const prev = get().activeLayoutSupervisor
    if (prev && prev !== next) {
      try {
        prev.kill()
      } catch {
        /* worker already terminated */
      }
    }
    set({ activeLayoutSupervisor: next })
  },
  releaseLayoutSupervisor: (handle: LayoutSupervisorHandle | null) => {
    if (get().activeLayoutSupervisor === handle) {
      get().setActiveLayoutSupervisor(null) // clears the slot, killing `handle`
    } else {
      try {
        handle?.kill()
      } catch {
        /* worker already terminated */
      }
    }
  },

  setSelectedNode: (nodeId: string | null, moveToSelectedNode?: boolean) =>
    set({ selectedNode: nodeId, moveToSelectedNode }),
  setFocusedNode: (nodeId: string | null) => set({ focusedNode: nodeId }),
  setSelectedEdge: (edgeId: string | null) => set({ selectedEdge: edgeId }),
  setFocusedEdge: (edgeId: string | null) => set({ focusedEdge: edgeId }),
  clearSelection: () =>
    set({
      selectedNode: null,
      focusedNode: null,
      selectedEdge: null,
      focusedEdge: null
    }),
  reset: () => {
    set({
      selectedNode: null,
      focusedNode: null,
      selectedEdge: null,
      focusedEdge: null,
      rawGraph: null,
      sigmaGraph: null,  // to avoid other components from acccessing graph objects
      searchEngine: null,
      moveToSelectedNode: false,
      graphIsEmpty: false,
      graphNodeCount: 0,
      graphEdgeCount: 0,
      graph3DData: { nodes: [], links: [] },
      graph3DDataDelta: null,
      isIncrementalBuilding: false,
      incrementalMessage: ''
    });
  },

  setRawGraph: (rawGraph: RawGraph | null) =>
    set({
      rawGraph
    }),

  setSigmaGraph: (sigmaGraph: DirectedGraph | null) => {
    // Replace graph instance, no need to keep WebGL context. Sync the reactive
    // counts in the SAME set call so "graph" and "counts" are never observed out
    // of step (avoids GraphViewer briefly seeing a stale count and allocating an
    // edge picking buffer it must immediately rebuild away). The synthetic empty
    // placeholder graph carries a non-zero order/size but means "empty"; callers
    // override it back to 0/0 via setGraphCounts right after.
    set({
      sigmaGraph,
      graphNodeCount: sigmaGraph ? sigmaGraph.order : 0,
      graphEdgeCount: sigmaGraph ? sigmaGraph.size : 0
    });
  },

  setGraphCounts: (nodeCount: number, edgeCount: number) =>
    set({ graphNodeCount: nodeCount, graphEdgeCount: edgeCount }),

  setMoveToSelectedNode: (moveToSelectedNode?: boolean) => set({ moveToSelectedNode }),

  setSigmaInstance: (instance: any) => set({ sigmaInstance: instance }),

  setTypeColorMap: (typeColorMap: Map<string, string>) => set({ typeColorMap }),

  setSearchEngine: (engine: MiniSearch | null) => set({ searchEngine: engine }),
  resetSearchEngine: () => set({ searchEngine: null }),

  // Methods to set global flags
  setGraphDataFetchAttempted: (attempted: boolean) => set({ graphDataFetchAttempted: attempted }),
  setLabelsFetchAttempted: (attempted: boolean) => set({ labelsFetchAttempted: attempted }),

  // Node operation state
  nodeToExpand: null,
  nodeToPrune: null,

  // Event trigger methods for node operations
  triggerNodeExpand: (nodeId: string | null) => set({ nodeToExpand: nodeId }),
  triggerNodePrune: (nodeId: string | null) => set({ nodeToPrune: nodeId }),

  // Version counter implementation
  graphDataVersion: 0,
  incrementGraphDataVersion: () => set((state) => ({ graphDataVersion: state.graphDataVersion + 1 })),

  // 3D force-graph state
  graph3DData: { nodes: [], links: [] },
  setGraph3DData: (data: Graph3DData) => set({ graph3DData: data }),
  graph3DDataDelta: null,
  setGraph3DDataDelta: (delta: { newNodes: number; newEdges: number } | null) => set({ graph3DDataDelta: delta }),
  isIncrementalBuilding: false,
  setIsIncrementalBuilding: (building: boolean) => set({ isIncrementalBuilding: building }),
  incrementalMessage: '',
  setIncrementalMessage: (msg: string) => set({ incrementalMessage: msg }),

  // Methods for updating graph elements and UI state together
  updateNodeAndSelect: async (nodeId: string, entityId: string, propertyName: string, newValue: string) => {
    // Get current state
    const state = get()
    const { sigmaGraph, rawGraph } = state

    // Validate graph state
    if (!sigmaGraph || !rawGraph || !sigmaGraph.hasNode(nodeId)) {
      return
    }

    try {
      const nodeAttributes = sigmaGraph.getNodeAttributes(nodeId)

      console.log('updateNodeAndSelect', nodeId, entityId, propertyName, newValue)

      // For entity_id changes (node renaming) with raw graph storage
      if ((nodeId === entityId) && (propertyName === 'entity_id')) {
        // Create new node with updated ID but same attributes
        sigmaGraph.addNode(newValue, { ...nodeAttributes, label: newValue })

        const edgesToUpdate: EdgeToUpdate[] = []

        // Process all edges connected to this node
        sigmaGraph.forEachEdge(nodeId, (edge, attributes, source, target) => {
          const otherNode = source === nodeId ? target : source
          const isOutgoing = source === nodeId

          // Get original edge dynamic ID for later reference
          const originalEdgeDynamicId = edge
          const edgeIndexInRawGraph = rawGraph.edgeDynamicIdMap[originalEdgeDynamicId]

          // Create new edge with updated node reference
          const newEdgeId = sigmaGraph.addEdge(
            isOutgoing ? newValue : otherNode,
            isOutgoing ? otherNode : newValue,
            attributes
          )

          // Track edges that need updating in the raw graph
          if (edgeIndexInRawGraph !== undefined) {
            edgesToUpdate.push({
              originalDynamicId: originalEdgeDynamicId,
              newEdgeId: newEdgeId,
              edgeIndex: edgeIndexInRawGraph
            })
          }

          // Remove the old edge
          sigmaGraph.dropEdge(edge)
        })

        // Remove the old node after all edges are processed
        sigmaGraph.dropNode(nodeId)

        // Update node reference in raw graph data
        const nodeIndex = rawGraph.nodeIdMap[nodeId]
        if (nodeIndex !== undefined) {
          rawGraph.nodes[nodeIndex].id = newValue
          rawGraph.nodes[nodeIndex].labels = [newValue]
          rawGraph.nodes[nodeIndex].properties.entity_id = newValue
          delete rawGraph.nodeIdMap[nodeId]
          rawGraph.nodeIdMap[newValue] = nodeIndex
        }

        // Update all edge references in raw graph data
        edgesToUpdate.forEach(({ originalDynamicId, newEdgeId, edgeIndex }) => {
          if (rawGraph.edges[edgeIndex]) {
            // Update source/target references
            if (rawGraph.edges[edgeIndex].source === nodeId) {
              rawGraph.edges[edgeIndex].source = newValue
            }
            if (rawGraph.edges[edgeIndex].target === nodeId) {
              rawGraph.edges[edgeIndex].target = newValue
            }

            // Update dynamic ID mappings
            rawGraph.edges[edgeIndex].dynamicId = newEdgeId
            delete rawGraph.edgeDynamicIdMap[originalDynamicId]
            rawGraph.edgeDynamicIdMap[newEdgeId] = edgeIndex
          }
        })

        // Update selected node in store
        set({ selectedNode: newValue, moveToSelectedNode: true })
      } else {
        // For non-NetworkX nodes or non-entity_id changes
        const nodeIndex = rawGraph.nodeIdMap[String(nodeId)]
        if (nodeIndex !== undefined) {
          const nodeRef = rawGraph.nodes[nodeIndex]
          nodeRef.properties[propertyName] = newValue
          if (propertyName === 'entity_id') {
            nodeRef.labels = [newValue]
            sigmaGraph.setNodeAttribute(String(nodeId), 'label', newValue)
          }
          if (propertyName === 'entity_type') {
            const { color, map, updated } = resolveNodeColor(newValue, state.typeColorMap)
            const resolvedColor = color || DEFAULT_NODE_COLOR
            nodeRef.color = resolvedColor
            sigmaGraph.setNodeAttribute(String(nodeId), 'color', resolvedColor)
            if (updated) {
              set({ typeColorMap: map })
            }
          }
        }

        // Trigger a re-render by incrementing the version counter
        set((state) => ({ graphDataVersion: state.graphDataVersion + 1 }))
      }
    } catch (error) {
      console.error('Error updating node in graph:', error)
      throw createErrorWithCause('Failed to update node in graph', error)
    }
  },

  updateEdgeAndSelect: async (edgeId: string, dynamicId: string, sourceId: string, targetId: string, propertyName: string, newValue: string) => {
    // Get current state
    const state = get()
    const { sigmaGraph, rawGraph } = state

    // Validate graph state
    if (!sigmaGraph || !rawGraph) {
      return
    }

    try {
      const edgeIndex = rawGraph.edgeIdMap[String(edgeId)]
      if (edgeIndex !== undefined && rawGraph.edges[edgeIndex]) {
        rawGraph.edges[edgeIndex].properties[propertyName] = newValue
        if(dynamicId !== undefined && propertyName === 'keywords') {
          sigmaGraph.setEdgeAttribute(dynamicId, 'label', newValue)
        }
      }

      // Trigger a re-render by incrementing the version counter
      set((state) => ({ graphDataVersion: state.graphDataVersion + 1 }))

      // Update selected edge in store to ensure UI reflects changes
      set({ selectedEdge: dynamicId })
    } catch (error) {
      console.error(`Error updating edge ${sourceId}->${targetId} in graph:`, error)
      throw createErrorWithCause('Failed to update edge in graph', error)
    }
  }
}))

const useGraphStore = createSelectors(useGraphStoreBase)

export { useGraphStore }
