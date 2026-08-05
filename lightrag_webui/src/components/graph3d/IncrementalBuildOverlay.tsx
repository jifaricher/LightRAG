import { useTranslation } from 'react-i18next'
import { useGraphStore } from '@/stores/graph'

/**
 * Incremental build progress overlay.
 *
 * Shown while the pipeline is actively building the knowledge graph (entities
 * and relations being written to the graph store). Displays:
 * - The latest pipeline_status message (e.g. "Chunk 3 of 10 extracted 15 Ent + 8 Rel")
 * - Real-time node and edge counts in the 3D view
 * - A pulsing indicator dot
 *
 * This is the user-visible feedback for the "entities appearing one by one"
 * animation — the 3D nodes spring in via d3-force-3d, and this overlay tells
 * the user what the pipeline is doing right now.
 */
const IncrementalBuildOverlay = () => {
  const { t } = useTranslation()
  const isIncrementalBuilding = useGraphStore.use.isIncrementalBuilding()
  const incrementalMessage = useGraphStore.use.incrementalMessage()
  const graph3DData = useGraphStore.use.graph3DData()

  if (!isIncrementalBuilding) return null

  const nodeCount = graph3DData.nodes.length
  const edgeCount = graph3DData.links.length

  return (
    <div className="bg-background/80 absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border-2 px-4 py-2 backdrop-blur-lg">
      <span className="flex h-2 w-2 animate-pulse rounded-full bg-green-500" />
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium">
          {t('graphPanel.incremental.building', 'Building...')}
        </span>
        <span className="text-muted-foreground">
          {nodeCount} {t('graphPanel.sideBar.settings.node', 'nodes')} ·{' '}
          {edgeCount} {t('graphPanel.sideBar.settings.edge', 'edges')}
        </span>
        {incrementalMessage && (
          <span className="max-w-md truncate text-muted-foreground" title={incrementalMessage}>
            {incrementalMessage}
          </span>
        )}
      </div>
    </div>
  )
}

export default IncrementalBuildOverlay
