import { useCallback } from 'react'
import { useGraphStore } from '@/stores/graph'

/**
 * 3D graph event handlers.
 *
 * Handles node click/hover/background-click and writes selection state into
 * the shared store (selectedNode, focusedNode) so the engine-agnostic
 * PropertiesView (designed for 2D sigma) displays the same selected entity in
 * 3D mode without any modification.
 *
 * Unlike the 2D GraphControl, this does NOT own layout (3D uses react-force-
 * graph's built-in d3-force-3d, no FA2 worker) or reducers (react-force-graph
 * handles highlight via nodeColor/linkColor callbacks, not sigma reducers).
 */
export const useGraph3DEventHandlers = () => {
  const handleNodeClick = useCallback((node: any) => {
    useGraphStore.getState().setSelectedNode(node.id, false)
    useGraphStore.getState().setFocusedNode(node.id)
  }, [])

  const handleBackgroundClick = useCallback(() => {
    useGraphStore.getState().clearSelection()
  }, [])

  return { handleNodeClick, handleBackgroundClick }
}
