import { useEffect } from 'react'
import { useGraphStore } from '@/stores/graph'
import { rawGraphTo3DData } from '@/utils/graph3dData'

/**
 * Converts the store's rawGraph (populated by the 2D fetchGraph flow) into
 * the react-force-graph 3D format and writes it to store.graph3DData.
 *
 * This hook handles the STATIC (non-incremental) path: when the user switches
 * to 3D mode without a busy pipeline, the 3D view derives from the same
 * rawGraph that 2D already loaded. The incremental poller (useIncrementalGraph)
 * takes over the store.graph3DData source when the pipeline is busy.
 *
 * The color map is committed to store.typeColorMap so the Legend stays in sync.
 */
const useLightragGraph3D = () => {
  const rawGraph = useGraphStore.use.rawGraph()
  const graph3DData = useGraphStore.use.graph3DData()
  const isIncrementalBuilding = useGraphStore.use.isIncrementalBuilding()

  // Only convert rawGraph → 3D when NOT in incremental building mode (the
  // poller owns graph3DData then). Also skip if rawGraph hasn't loaded yet.
  useEffect(() => {
    if (isIncrementalBuilding) return
    if (!rawGraph) return

    const { data, updatedColorMap } = rawGraphTo3DData(rawGraph, useGraphStore.getState().typeColorMap)

    // Only update if node count changed (avoid clobbering incremental state
    // that might have been written before the building flag flipped).
    const current = useGraphStore.getState().graph3DData
    if (current.nodes.length !== data.nodes.length || current.links.length !== data.links.length) {
      useGraphStore.getState().setGraph3DData(data)
    }
    if (updatedColorMap.size > 0) {
      useGraphStore.getState().setTypeColorMap(updatedColorMap)
    }
  }, [rawGraph, isIncrementalBuilding])

  return {
    graph3DData,
    nodeCount: graph3DData.nodes.length,
    edgeCount: graph3DData.links.length
  }
}

export default useLightragGraph3D
