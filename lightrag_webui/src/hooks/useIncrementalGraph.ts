import { useEffect, useRef } from 'react'
import { useGraphStore } from '@/stores/graph'
import { useSettingsStore } from '@/stores/settings'
import { queryGraphs, getPipelineStatus } from '@/api/lightrag'
import { diffIntoGraphData, initKnownIds } from '@/utils/graph3dData'
import {
  INCREMENTAL_POLL_INTERVAL_MS,
  INCREMENTAL_NO_CHANGE_STOP_THRESHOLD
} from '@/lib/constants'

/**
 * Incremental build animation poller.
 *
 * While the pipeline is busy (entities/relations being written to the graph
 * store), this hook polls GET /graphs every INCREMENTAL_POLL_INTERVAL_MS,
 * diffs the response against the known node/edge id sets, and pushes only the
 * newly added nodes/edges into store.graph3DData. Existing nodes keep their
 * d3-force-3d coordinates (x/y/z/vx/vy/vz) so the simulation nudges them
 * gently while new nodes spring into place — the "entities appearing one by
 * one" visual effect.
 *
 * Since the backend has no SSE/WebSocket, polling is the only way to see new
 * entities as they're written. The poller stops after
 * INCREMENTAL_NO_CHANGE_STOP_THRESHOLD consecutive polls with no new nodes AND
 * pipeline busy === false, confirming the build has converged.
 *
 * The ForceGraph3DContainer reads store.graph3DData and calls the imperative
 * fg.graphData() to apply the delta (prop-driven updates would reset the entire
 * force simulation, undoing the incremental effect).
 */
const useIncrementalGraph = () => {
  const enableIncrementalBuild = useSettingsStore.use.enableIncrementalBuild()
  const graphViewMode = useSettingsStore.use.graphViewMode()

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const knownNodeIdsRef = useRef<Set<string>>(new Set())
  const knownEdgeIdsRef = useRef<Set<string>>(new Set())
  const noChangeStreakRef = useRef(0)
  const isPollingRef = useRef(false)

  useEffect(() => {
    // Only poll in 3D mode with incremental build enabled
    if (graphViewMode !== '3d' || !enableIncrementalBuild) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      useGraphStore.getState().setIsIncrementalBuilding(false)
      return
    }

    // Initialize known-id sets from whatever 3D data is already loaded
    // (e.g. the static full load from useLightragGraph3D)
    const current3D = useGraphStore.getState().graph3DData
    if (current3D.nodes.length > 0) {
      const { nodeIds, edgeIds } = initKnownIds(current3D)
      knownNodeIdsRef.current = nodeIds
      knownEdgeIdsRef.current = edgeIds
    }

    let cancelled = false

    const tick = async () => {
      if (cancelled || isPollingRef.current) return
      isPollingRef.current = true

      try {
        const state = useGraphStore.getState()
        // Use settings from store for label/depth/maxNodes
        const settings = useSettingsStore.getState()
        const label = settings.queryLabel || '*'
        const maxDepth = settings.graphQueryMaxDepth
        const maxNodes = settings.graphMaxNodes

        const [graphResp, pipelineStatus] = await Promise.all([
          queryGraphs(label, maxDepth, maxNodes),
          getPipelineStatus()
        ])

        if (cancelled) return

        // Update progress message
        state.setIncrementalMessage(pipelineStatus.latest_message || '')
        state.setIsIncrementalBuilding(pipelineStatus.busy)

        // Diff and merge
        const { merged, newNodes, newEdges, updatedColorMap } = diffIntoGraphData(
          state.graph3DData,
          graphResp,
          knownNodeIdsRef.current,
          knownEdgeIdsRef.current,
          state.typeColorMap
        )

        if (newNodes > 0 || newEdges > 0) {
          noChangeStreakRef.current = 0
          state.setGraph3DData(merged)
          state.setGraph3DDataDelta({ newNodes, newEdges })
          if (updatedColorMap.size > 0) {
            state.setTypeColorMap(updatedColorMap)
          }
        } else {
          noChangeStreakRef.current++
        }

        // Stop condition: pipeline not busy AND no new nodes for N consecutive polls
        if (
          !pipelineStatus.busy &&
          noChangeStreakRef.current >= INCREMENTAL_NO_CHANGE_STOP_THRESHOLD
        ) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
          state.setIsIncrementalBuilding(false)
        }
      } catch (e) {
        // Transient network/API error — don't stop polling, just skip this tick
        console.error('Incremental graph poll failed:', e)
      } finally {
        isPollingRef.current = false
      }
    }

    // Do an immediate first tick, then start the interval
    tick()
    intervalRef.current = setInterval(tick, INCREMENTAL_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      useGraphStore.getState().setIsIncrementalBuilding(false)
    }
  }, [graphViewMode, enableIncrementalBuild])
}

export default useIncrementalGraph
