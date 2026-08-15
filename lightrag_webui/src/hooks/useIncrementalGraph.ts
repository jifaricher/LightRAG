import { useEffect, useRef } from 'react'
import { useGraphStore } from '@/stores/graph'
import { useSettingsStore } from '@/stores/settings'
import { queryGraphs, getPipelineStatus } from '@/api/lightrag'
import { diffIntoGraphData } from '@/utils/graph3dData'
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
 * entities as they're written. The poller enters **standby** after
 * INCREMENTAL_NO_CHANGE_STOP_THRESHOLD consecutive polls with no new nodes AND
 * pipeline busy === false, confirming the current build has converged.
 *
 * In standby it continues polling (only getPipelineStatus, lightweight) so
 * that when new documents are submitted and the pipeline becomes busy again,
 * full diffing resumes automatically — the drop-spring animation restarts for
 * the new batch without requiring a 2D↔3D toggle.
 *
 * The ForceGraph3DContainer reads store.graph3DData and applies deltas via
 * the graphData prop. Existing nodes are pinned (fx/fy/fz) so only new nodes
 * animate.
 */
const useIncrementalGraph = () => {
  const enableIncrementalBuild = useSettingsStore.use.enableIncrementalBuild()
  const graphViewMode = useSettingsStore.use.graphViewMode()

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const knownNodeIdsRef = useRef<Set<string>>(new Set())
  const knownEdgeIdsRef = useRef<Set<string>>(new Set())
  const noChangeStreakRef = useRef(0)
  const isPollingRef = useRef(false)
  // standbyRef: true once the current build has converged. While in standby,
  // the tick only calls getPipelineStatus (cheap). When the pipeline goes busy
  // again, standby is cleared and full graph diffing resumes.
  const standbyRef = useRef(false)

  useEffect(() => {
    // Only poll in 3D or 2.5D mode with incremental build enabled
    const is3DLike = graphViewMode === '3d' || graphViewMode === '2.5d'
    if (!is3DLike || !enableIncrementalBuild) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      useGraphStore.getState().setIsIncrementalBuilding(false)
      return
    }

    // Start from empty known-id sets so the first tick treats all current
    // graph nodes as "new" — they will drop in from high altitude one by one.
    // This is intentional: we want the drop-spring animation even for the
    // initial data, not just for nodes added after the poller starts.
    knownNodeIdsRef.current = new Set()
    knownEdgeIdsRef.current = new Set()
    // Clear existing 3D data and set building flag so useLightragGraph3D
    // doesn't clobber our incremental data with a full static load.
    useGraphStore.getState().setGraph3DData({ nodes: [], links: [] })
    useGraphStore.getState().setIsIncrementalBuilding(true)
    standbyRef.current = false

    let cancelled = false

    const tick = async () => {
      if (cancelled || isPollingRef.current) return
      isPollingRef.current = true

      try {
        const state = useGraphStore.getState()

        // Standby path: only fetch pipeline status. When the pipeline becomes
        // busy again (new documents submitted), exit standby and resume full
        // graph diffing on the next tick.
        if (standbyRef.current) {
          const pipelineStatus = await getPipelineStatus()
          if (cancelled) return
          state.setIncrementalMessage(pipelineStatus.latest_message || '')
          if (pipelineStatus.busy) {
            // New batch detected — resume full polling.
            // Reset known-id sets and clear 3D data so all nodes animate in
            // from far Z (fresh first-load drop) instead of being treated as
            // already-known (the stale known sets from the previous batch
            // would silently drop nodes that aren't in prevData anymore).
            standbyRef.current = false
            noChangeStreakRef.current = 0
            knownNodeIdsRef.current = new Set()
            knownEdgeIdsRef.current = new Set()
            state.setGraph3DData({ nodes: [], links: [] })
            state.setIsIncrementalBuilding(true)
          }
          return
        }

        // Active path: fetch both graph data and pipeline status
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

        // Standby condition: pipeline not busy AND no new nodes for N
        // consecutive polls. The interval stays alive but switches to the
        // lightweight standby path so a future busy=true (new documents)
        // resumes the animation automatically.
        if (
          !pipelineStatus.busy &&
          noChangeStreakRef.current >= INCREMENTAL_NO_CHANGE_STOP_THRESHOLD
        ) {
          standbyRef.current = true
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
