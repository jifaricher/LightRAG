import { useEffect, useRef, useCallback, useState } from 'react'
import { ForceGraph3D } from 'react-force-graph'
import { forceZ } from 'd3-force-3d'
import SpriteText from 'three-spritetext'
import { useTranslation } from 'react-i18next'
import { useGraphStore } from '@/stores/graph'
import { useSettingsStore } from '@/stores/settings'
import {
  FG3D_D3_ALPHA_DECAY,
  FG3D_D3_VELOCITY_DECAY,
  FG3D_COOLDOWN_TICKS,
  FG3D_NODE_REL_SIZE,
  FG3D_LINK_WIDTH,
  FG3D_NODE_PERF_LIMIT,
  FG3D25D_FORCE_Z_STRENGTH,
  FG3D25D_DROP_INITIAL_Z,
  FG3D25D_DROP_INITIAL_VZ,
  FG3D25D_DROP_LINK_STRENGTH,
  FG3D25D_DROP_LINK_DISTANCE,
  FG3D25D_DROP_LINK_DISTANCE_START,
  FG3D25D_DROP_EDGE_RADIUS,
  FG3D25D_CHARGE_STRENGTH,
  FG3D25D_CAMERA_POSITION,
  controlButtonVariant
} from '@/lib/constants'
import useIsDarkMode from '@/hooks/useIsDarkMode'
import Button from '@/components/ui/Button'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import * as THREE from 'three'

interface ForceGraph25DContainerProps {
  onNodeClick?: (node: any) => void
  onBackgroundClick?: () => void
}

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255
  }
}

/**
 * 2.5D force-graph wrapper — steady state is a flat z=0 plane (looks like 2D
 * from the top-down camera), but new nodes drop in from z+y mixed far distance
 * with a 3D spring animation.
 *
 * Key difference from ForceGraph3DContainer:
 * - Injects d3-force-3d `forceZ(0)` to pull all nodes toward z=0 plane
 * - New nodes spawn at z=2000 + y=-2000 (mixed-depth drop trajectory)
 * - Existing nodes are pinned with fz=0 (locked to the plane)
 * - Camera is positioned for a top-down view with slight perspective
 */
const ForceGraph25DContainer = ({ onNodeClick, onBackgroundClick }: ForceGraph25DContainerProps) => {
  const fgRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 600 })
  const isDarkMode = useIsDarkMode()
  const graph3DData = useGraphStore.use.graph3DData()
  const isIncrementalBuilding = useGraphStore.use.isIncrementalBuilding()
  const show3DNodeLabel = useSettingsStore.use.show3DNodeLabel()
  const { t } = useTranslation()

  const initializedRef = useRef(false)

  // Whether we're waiting for the simulation to settle before calling zoomToFit
  const pendingZoomFitRef = useRef(false)

  useEffect(() => {
    if (graph3DData.nodes.length === 0) {
      initializedRef.current = false
    }
  }, [graph3DData])

  // Cleanup window ref on unmount
  useEffect(() => {
    return () => { delete (window as any).__forceGraph3DRef }
  }, [])

  const hoverNodeRef = useRef<string | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect
      if (cr.width > 0 && cr.height > 0) {
        setDims({ width: Math.round(cr.width), height: Math.round(cr.height) })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const lightingSetupRef = useRef(false)
  const onEngineTick = useCallback(() => {
    const fg = fgRef.current
    if (!fg || typeof fg.scene !== 'function') return

    // Register fg ref on window for LayoutsControl3D (once per mount)
    if (!(window as any).__forceGraph3DRef) {
      ;(window as any).__forceGraph3DRef = fg
    }

    // --- One-time setup: link strength, charge, forceZ, lighting ---
    if (!lightingSetupRef.current) {
      const forceLink0 = fg.d3Force('link')
      if (forceLink0) {
        forceLink0.strength(FG3D25D_DROP_LINK_STRENGTH)
        forceLink0.distance(FG3D25D_DROP_LINK_DISTANCE_START)
      }

      const forceCharge = fg.d3Force('charge')
      if (forceCharge) {
        forceCharge.strength(FG3D25D_CHARGE_STRENGTH)
      }

      // === 2.5D key: inject forceZ to pull all nodes toward z=0 plane ===
      fg.d3Force('z', forceZ(0).strength(FG3D25D_FORCE_Z_STRENGTH))

      const scene = fg.scene()
      if (scene) {
        const ambient = new THREE.AmbientLight(isDarkMode ? 0x404060 : 0xffffff, isDarkMode ? 0.6 : 0.8)
        scene.add(ambient)

        const dirLight = new THREE.DirectionalLight(isDarkMode ? 0x8899ff : 0xffffff, isDarkMode ? 0.8 : 0.6)
        dirLight.position.set(200, 300, 200)
        scene.add(dirLight)

        const pointLight = new THREE.PointLight(isDarkMode ? 0x6688ff : 0xffffff, isDarkMode ? 0.5 : 0.3)
        pointLight.position.set(0, 0, 300)
        scene.add(pointLight)
      }

      lightingSetupRef.current = true
    }

    // --- Every tick: shrink link distance as simulation converges ---
    // Per-edge target distance scales with edge weight: high-weight edges
    // settle short, low-weight edges settle long — like 2D ForceAtlas2.
    const forceLink = fg.d3Force('link')
    if (forceLink) {
      const alpha = typeof forceLink.alpha === 'function' ? forceLink.alpha() : 1
      const t = 1 - alpha
      const startDist = FG3D25D_DROP_LINK_DISTANCE_START
      const baseDist = FG3D25D_DROP_LINK_DISTANCE
      forceLink.distance((link: any) => {
        const w = typeof link.width === 'number' ? link.width : 1
        const targetDist = baseDist * (2 / Math.max(1, w * 0.5))
        return startDist * (1 - t) + targetDist * t
      })
    }
  }, [isDarkMode])

  // Drop-spring animation: new nodes drill into screen from far z (toward
  // viewer) into the z=0 plane. Existing nodes are pinned with fz=0.
  useEffect(() => {
    const currentData = useGraphStore.getState().graph3DData
    if (currentData.nodes.length === 0) return

    const isFirstLoad = !initializedRef.current

    if (isFirstLoad) {
      // First load: all nodes drill in from far z
      currentData.nodes.forEach((n: any) => {
        n.z = FG3D25D_DROP_INITIAL_Z
        n.vz = FG3D25D_DROP_INITIAL_VZ
      })
      initializedRef.current = true
    } else {
      // Incremental: pin existing nodes (XY locked, z forced to 0 plane)
      // New nodes spawn on a ring around the graph centroid (outer edge)
      // at far Z, then get pulled inward by the link spring — "converge
      // from edge to center" effect.
      let cx = 0, cy = 0, count = 0
      for (const n of currentData.nodes) {
        if (n.x !== undefined && n.y !== undefined) {
          cx += n.x
          cy += n.y
          count++
        }
      }
      if (count > 0) { cx /= count; cy /= count }

      let angleIdx = 0
      currentData.nodes.forEach((n: any) => {
        if (n.x !== undefined && n.y !== undefined) {
          // Existing node: pin XY, force z=0 plane
          n.fx = n.x
          n.fy = n.y
          n.fz = 0
          n.vx = 0
          n.vy = 0
          n.vz = 0
        } else {
          // New node: spawn on outer ring around centroid, far Z for drop
          const angle = (angleIdx * 137.5) * Math.PI / 180 // golden angle for even spread
          angleIdx++
          n.x = cx + FG3D25D_DROP_EDGE_RADIUS * Math.cos(angle)
          n.y = cy + FG3D25D_DROP_EDGE_RADIUS * Math.sin(angle)
          n.z = FG3D25D_DROP_INITIAL_Z
          n.vx = 0
          n.vy = 0
          n.vz = FG3D25D_DROP_INITIAL_VZ
        }
      })
    }

    const fg = fgRef.current
    if (fg) {
      if (isFirstLoad) {
        if (typeof fg.d3ReheatSimulation === 'function') {
          fg.d3ReheatSimulation()
        }
        // zoomToFit is called from onEngineStop after the simulation settles,
        // so it fits the bounding box of converged nodes (z=0 plane) instead
        // of the initial far-z positions which would make the graph tiny.
        pendingZoomFitRef.current = true
      } else {
        // Incremental: moderate alpha so new nodes snap in quickly but
        // existing pinned nodes aren't disturbed.
        const sim = fg.d3Force?.()
        if (sim && typeof sim.alpha === 'function') {
          sim.alpha(0.3)
          sim.restart()
        }
      }
    }
  }, [graph3DData])

  const nodeThreeObject = useCallback(
    (node: any) => {
      if (!show3DNodeLabel) return undefined
      const showLabels = graph3DData.nodes.length <= FG3D_NODE_PERF_LIMIT
      if (!showLabels) return undefined
      if (node.val < 5) return undefined

      const group = new THREE.Group()
      const label = node.label || node.name || node.id
      const sprite = new SpriteText(label, 14, isDarkMode ? '#e0e0ff' : '#1a1a2e')
      sprite.textHeight = 8
      sprite.padding = 3
      sprite.backgroundColor = isDarkMode ? 'rgba(10,10,30,0.7)' : 'rgba(255,255,255,0.7)'
      sprite.borderColor = isDarkMode ? 'rgba(100,120,200,0.3)' : 'rgba(100,120,200,0.3)'
      sprite.borderWidth = 1
      sprite.position.y = 8
      group.add(sprite)
      return group
    },
    [graph3DData.nodes.length, isDarkMode, show3DNodeLabel]
  )

  const nodeMaterial = useCallback((node: any) => {
    const rgb = hexToRgb(node.color || '#4488ff')
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(rgb.r, rgb.g, rgb.b),
      emissive: new THREE.Color(rgb.r * 0.3, rgb.g * 0.3, rgb.b * 0.3),
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.5,
      transparent: true,
      opacity: 0.92
    })
    return mat
  }, [])

  const linkMaterial = useCallback(() => {
    const mat = new THREE.LineBasicMaterial({
      color: isDarkMode ? 0x4a6fa5 : 0x8899bb,
      transparent: true,
      opacity: 0.35,
      linewidth: FG3D_LINK_WIDTH
    })
    return mat
  }, [isDarkMode])

  const handleNodeHover = useCallback((node: any) => {
    hoverNodeRef.current = node?.id ?? null
  }, [])

  // Called once when the d3 simulation settles. Pin all nodes' z to 0 so
  // frozen layouts (Circular, Circlepack, Random) that deleted fz for the
  // drop animation don't keep jittering on the Z axis due to link/forceZ
  // residual forces fighting each other.
  const onEngineStop = useCallback(() => {
    pendingZoomFitRef.current = false
    const data = useGraphStore.getState().graph3DData
    data.nodes.forEach((n: any) => {
      if (n.fx !== undefined && n.fy !== undefined && n.fz === undefined) {
        n.fz = 0
        n.z = 0
        n.vz = 0
      }
    })
  }, [])

  const handleZoomIn = useCallback(() => {
    const fg = fgRef.current
    if (!fg || typeof fg.cameraPosition !== 'function') return
    const cam = fg.cameraPosition()
    fg.cameraPosition({ x: cam.x, y: cam.y, z: cam.z * 0.8 }, undefined, 200)
  }, [])
  const handleZoomOut = useCallback(() => {
    const fg = fgRef.current
    if (!fg || typeof fg.cameraPosition !== 'function') return
    const cam = fg.cameraPosition()
    fg.cameraPosition({ x: cam.x, y: cam.y, z: cam.z * 1.2 }, undefined, 200)
  }, [])
  const handleResetZoom = useCallback(() => {
    fgRef.current?.zoomToFit(300, 60)
  }, [])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <ForceGraph3D
        ref={fgRef}
        graphData={graph3DData}
        backgroundColor={isDarkMode ? '#080812' : '#f0f2f8'}
        nodeColor={(node: any) => node.color}
        nodeRelSize={FG3D_NODE_REL_SIZE}
        nodeVal={(node: any) => node.val}
        nodeLabel={(node: any) => node.label || node.name || node.id}
        nodeMaterial={nodeMaterial}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={true}
        nodeOpacity={0.92}
        linkColor={() => (isDarkMode ? '#4a6fa5' : '#8899bb')}
        linkWidth={FG3D_LINK_WIDTH}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={0.4}
        linkDirectionalParticleSpeed={0.004}
        linkMaterial={linkMaterial}
        linkLabel={(link: any) => link.label || ''}
        linkCurvature={0}
        cooldownTicks={FG3D_COOLDOWN_TICKS}
        d3AlphaDecay={FG3D_D3_ALPHA_DECAY}
        d3VelocityDecay={FG3D_D3_VELOCITY_DECAY}
        onEngineTick={onEngineTick}
        onEngineStop={onEngineStop}
        onNodeClick={onNodeClick}
        onNodeHover={handleNodeHover}
        onBackgroundClick={onBackgroundClick}
        width={dims.width}
        height={dims.height}
        pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
        cameraPosition={FG3D25D_CAMERA_POSITION}
        enableNodeDrag={true}
        showNavHint={false}
      />

      {/* Zoom controls — bottom-left, matching 2D layout */}
      <div className="bg-background/60 absolute bottom-2 left-2 flex flex-col rounded-xl border-2 backdrop-blur-lg">
        <Button
          variant={controlButtonVariant}
          size="icon"
          onClick={handleZoomIn}
          tooltip={t('graphPanel.sideBar.zoomControl.zoomIn')}
        >
          <ZoomIn />
        </Button>
        <Button
          variant={controlButtonVariant}
          size="icon"
          onClick={handleZoomOut}
          tooltip={t('graphPanel.sideBar.zoomControl.zoomOut')}
        >
          <ZoomOut />
        </Button>
        <Button
          variant={controlButtonVariant}
          size="icon"
          onClick={handleResetZoom}
          tooltip={t('graphPanel.sideBar.zoomControl.resetZoom')}
        >
          <Maximize />
        </Button>
      </div>

      {/* Build-in-progress indicator */}
      {isIncrementalBuilding && (
        <div className="bg-background/80 absolute top-2 right-2 rounded-lg border-2 px-3 py-1.5 backdrop-blur-lg">
          <span className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            {t('graphPanel.incremental.building', 'Building...')}
          </span>
        </div>
      )}
    </div>
  )
}

export default ForceGraph25DContainer
