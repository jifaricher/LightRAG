import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings'
import { Box, Layers, Type } from 'lucide-react'

import ForceGraph3DContainer from '@/components/graph3d/ForceGraph3DContainer'
import { useGraph3DEventHandlers } from '@/components/graph3d/Graph3DControl'
import IncrementalBuildOverlay from '@/components/graph3d/IncrementalBuildOverlay'

import GraphLabels from '@/components/graph/GraphLabels'
import PropertiesView from '@/components/graph/PropertiesView'
import Legend from '@/components/graph/Legend'
import LegendButton from '@/components/graph/LegendButton'
import SettingsDisplay from '@/components/graph/SettingsDisplay'

import useLightragGraph3D from '@/hooks/useLightragGraph3D'
import useIncrementalGraph from '@/hooks/useIncrementalGraph'

import { controlButtonVariant } from '@/lib/constants'
import Button from '@/components/ui/Button'

/**
 * 3D force-graph viewer (react-force-graph + Three.js + d3-force-3d).
 *
 * Layout mirrors the 2D GraphViewer: force-graph canvas fills the container,
 * with floating control panels (labels, properties, legend) overlaid
 * absolutely. Engine-agnostic components (GraphLabels, PropertiesView, Legend,
 * SettingsDisplay) are reused unchanged — they read from the same store.
 *
 * Two data paths converge on store.graph3DData:
 * - Static (pipeline idle): useLightragGraph3D converts rawGraph → 3D format.
 * - Incremental (pipeline busy): useIncrementalGraph polls GET /graphs every
 *   2.5s, diffs new nodes/edges, and pushes them in via imperative API.
 *
 * The incremental path produces the "entities appearing one by one" animation:
 * d3-force-3d springs new nodes into place while nudging existing ones.
 */
const GraphViewer3D = () => {
  const { t } = useTranslation()

  // Hooks: static data conversion + incremental polling
  useLightragGraph3D()
  useIncrementalGraph()

  const showPropertyPanel = useSettingsStore.use.showPropertyPanel()
  const showLegend = useSettingsStore.use.showLegend()
  const show3DNodeLabel = useSettingsStore.use.show3DNodeLabel()
  const setShow3DNodeLabel = useSettingsStore.use.setShow3DNodeLabel()

  const { handleNodeClick, handleBackgroundClick } = useGraph3DEventHandlers()

  const graphViewMode = useSettingsStore.use.graphViewMode()
  const setGraphViewMode = useSettingsStore.use.setGraphViewMode()

  // Placeholder: FullScreenControl in 3D uses the container element
  const handleFullScreen = useCallback(() => {
    const el = document.querySelector('.force-graph-3d-container')
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      el.requestFullscreen?.()
    }
  }, [])

  return (
    <div className="force-graph-3d-container relative h-full w-full overflow-hidden">
      <ForceGraph3DContainer
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
        <Button
          variant={controlButtonVariant}
          size="icon"
          onClick={handleFullScreen}
          tooltip={t('graphPanel.sideBar.fullScreenControl.fullScreen')}
        >
          <Box />
        </Button>
        {/* 2D/3D view toggle */}
        <Button
          variant={graphViewMode === '2d' ? 'secondary' : controlButtonVariant}
          size="icon"
          onClick={() => setGraphViewMode('2d')}
          tooltip={t('graphPanel.viewMode.2d', '2D View')}
        >
          <Layers />
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

export default GraphViewer3D
