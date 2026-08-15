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
 *
 * IMPORTANT: the 3D data has NO nodes AND there is no rawGraph yet (first load).
 * The "node count changed" guard at L31 prevents overwriting incremental data
 * that was already populated by the poller before isIncrementalBuilding flipped
 * back to false — but only when incremental data has MORE nodes than rawGraph.
 * When incremental built up e.g. 200 nodes and rawGraph (stale, from an earlier
 * 2D fetch) has 50, the guard correctly skips the overwrite.
 *
 * However, when the graph was CLEAR-AND-REBUILT (data reset), rawGraph may
 * briefly have 0 nodes while incremental data also has 0 — the guard would
 * pass and write empty data. This is fine because the poller will repopulate.
 */
const useLightragGraph3D = () => {
  const rawGraph = useGraphStore.use.rawGraph()
  const graph3DData = useGraphStore.use.graph3DData()
  const isIncrementalBuilding = useGraphStore.use.isIncrementalBuilding()

  useEffect(() => {
    if (isIncrementalBuilding) return
    if (!rawGraph) return

    const { data, updatedColorMap } = rawGraphTo3DData(rawGraph, useGraphStore.getState().typeColorMap)

    // Guard: only overwrite if the static conversion has MORE nodes than
    // what's already in the store. This prevents clobbering incremental
    // data (which may have accumulated more nodes than the stale rawGraph)
    // when isIncrementalBuilding flips to false after the pipeline finishes.
    // The incremental poller remains the source of truth until the user
    // manually refreshes the 2D graph (which sets rawGraph fresh).
    const current = useGraphStore.getState().graph3DData
    if (data.nodes.length > current.nodes.length) {
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
