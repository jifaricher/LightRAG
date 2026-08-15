import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings'
import { Box, Layers, Boxes, Type } from 'lucide-react'

import ForceGraph25DContainer from '@/components/graph3d/ForceGraph25DContainer'
import { useGraph3DEventHandlers } from '@/components/graph3d/Graph3DControl'
import IncrementalBuildOverlay from '@/components/graph3d/IncrementalBuildOverlay'
import LayoutsControl3D from '@/components/graph3d/LayoutsControl3D'

import GraphLabels from '@/components/graph/GraphLabels'
import PropertiesView from '@/components/graph/PropertiesView'
import Legend from '@/components/graph/Legend'
import LegendButton from '@/components/graph/LegendButton'
import SettingsDisplay from '@/components/graph/SettingsDisplay'
import Settings from '@/components/graph/Settings'

import useLightragGraph3D from '@/hooks/useLightragGraph3D'
import useIncrementalGraph from '@/hooks/useIncrementalGraph'

import { controlButtonVariant } from '@/lib/constants'
import Button from '@/components/ui/Button'

/**
 * 2.5D force-graph viewer — steady state is a flat z=0 plane (looks like 2D
 * from top-down camera), but new entities drop in from z+y mixed far distance
 * with 3D spring animation. Reuses the same store, hooks, and overlay panels
 * as GraphViewer3D; only the container component differs.
 */
const GraphViewer25D = () => {
  const { t } = useTranslation()

  useLightragGraph3D()
  useIncrementalGraph()

  const showPropertyPanel = useSettingsStore.use.showPropertyPanel()
  const showLegend = useSettingsStore.use.showLegend()
  const show3DNodeLabel = useSettingsStore.use.show3DNodeLabel()
  const setShow3DNodeLabel = useSettingsStore.use.setShow3DNodeLabel()

  const { handleNodeClick, handleBackgroundClick } = useGraph3DEventHandlers()

  const graphViewMode = useSettingsStore.use.graphViewMode()
  const setGraphViewMode = useSettingsStore.use.setGraphViewMode()

  const handleFullScreen = useCallback(() => {
    const el = document.querySelector('.force-graph-25d-container')
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      el.requestFullscreen?.()
    }
  }, [])

  return (
    <div className="force-graph-25d-container relative h-full w-full overflow-hidden">
      <ForceGraph25DContainer
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
      />

      {/* Top-left: label selector + search */}
      <div className="absolute top-2 left-2 flex items-start gap-2">
        <GraphLabels />
      </div>

      {/* Bottom-left: controls */}
      <div className="bg-background/60 absolute bottom-2 left-2 flex flex-col rounded-xl border-2 backdrop-blur-lg">
        <Button
          variant={show3DNodeLabel ? 'secondary' : controlButtonVariant}
          size="icon"
          onClick={() => setShow3DNodeLabel(!show3DNodeLabel)}
          tooltip={t('graphPanel.sideBar.settings.showNodeLabel')}
        >
          <Type />
        </Button>
        <LegendButton />
        <Settings />
        <LayoutsControl3D />
        <Button
          variant={controlButtonVariant}
          size="icon"
          onClick={handleFullScreen}
          tooltip={t('graphPanel.sideBar.fullScreenControl.fullScreen')}
        >
          <Box />
        </Button>
        {/* 2D/2.5D/3D view toggle */}
        <Button
          variant={graphViewMode === '2d' ? 'secondary' : controlButtonVariant}
          size="icon"
          onClick={() => setGraphViewMode('2d')}
          tooltip={t('graphPanel.viewMode.2d', '2D View')}
        >
          <Layers />
        </Button>
        <Button
          variant={graphViewMode === '2.5d' ? 'secondary' : controlButtonVariant}
          size="icon"
          onClick={() => setGraphViewMode('2.5d')}
          tooltip={t('graphPanel.viewMode.25d', '2.5D View')}
        >
          <Boxes />
        </Button>
        <Button
          variant={graphViewMode === '3d' ? 'secondary' : controlButtonVariant}
          size="icon"
          onClick={() => setGraphViewMode('3d')}
          tooltip={t('graphPanel.viewMode.3d', '3D View')}
        >
          <Box />
        </Button>
      </div>

      {/* Top-right: properties panel (engine-agnostic, reads store) */}
      {showPropertyPanel && (
        <div className="absolute top-2 right-2 z-10">
          <PropertiesView />
        </div>
      )}

      {/* Bottom-right: legend (engine-agnostic, reads typeColorMap) */}
      {showLegend && (
        <div className="absolute right-2 bottom-10 z-0">
          <Legend className="bg-background/60 backdrop-blur-lg" />
        </div>
      )}

      {/* Bottom-center: status bar */}
      <div className="absolute bottom-2 right-2 z-0">
        <SettingsDisplay />
      </div>

      {/* Top-center: incremental build progress overlay */}
      <IncrementalBuildOverlay />
    </div>
  )
}

export default GraphViewer25D
