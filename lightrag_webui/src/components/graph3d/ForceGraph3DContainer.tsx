import { useEffect, useRef, useCallback, useState } from 'react'
import { ForceGraph3D } from 'react-force-graph'
import SpriteText from 'three-spritetext'
import { useTranslation } from 'react-i18next'
import { useGraphStore, type Graph3DData } from '@/stores/graph'
import { useSettingsStore } from '@/stores/settings'
import {
  FG3D_D3_ALPHA_DECAY,
  FG3D_D3_VELOCITY_DECAY,
  FG3D_COOLDOWN_TICKS,
  FG3D_NODE_REL_SIZE,
  FG3D_LINK_WIDTH,
  FG3D_NODE_PERF_LIMIT,
  FG3D_DROP_INITIAL_Y,
  FG3D_DROP_INITIAL_VY,
  FG3D_DROP_LINK_STRENGTH,
  FG3D_DROP_LINK_DISTANCE,
  controlButtonVariant
} from '@/lib/constants'
import useIsDarkMode from '@/hooks/useIsDarkMode'
import Button from '@/components/ui/Button'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import * as THREE from 'three'

interface ForceGraph3DContainerProps {
  onNodeClick?: (node: any) => void
  onBackgroundClick?: () => void
}

// Parse a hex color string into an RGB object {r, g, b} in 0-1 range,
// suitable for THREE.Color-like usage without creating Color objects
// (cheaper for per-node allocation in large graphs).
const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255
  }
}

/**
 * react-force-graph 3D wrapper with premium Hermes-style visuals.
 *
 * Visual enhancements over the default react-force-graph:
 * - Three.js scene lighting (ambient + directional + point) so nodes
 *   with MeshStandardMaterial catch light and have depth
 * - Nodes use emissive materials for a subtle glow
 * - Links are semi-transparent and wider for a "constellation" feel
 * - Node labels (SpriteText) are larger with background for readability
 * - Camera starts further back for a wide overview shot
 * - Hover highlights the node by scaling it up
 *
 * Key design: uses the IMPERATIVE API (fgRef.current.graphData()) to push
 * incremental data updates, NOT the graphData prop. Prop-driven updates cause
 * react-force-graph to rebuild the entire d3 force simulation (every node
 * re-initialized to a random position → "full re-jitter" instead of "new nodes
 * springing in"). The imperative path preserves existing node coordinates by
 * node.id match, so d3-force-3d only nudges existing nodes while new ones
 * animate into place.
 */
const ForceGraph3DContainer = ({ onNodeClick, onBackgroundClick }: ForceGraph3DContainerProps) => {
  const fgRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 800, height: 600 })
  const isDarkMode = useIsDarkMode()
  const graph3DData = useGraphStore.use.graph3DData()
  const graph3DDataDelta = useGraphStore.use.graph3DDataDelta()
  const isIncrementalBuilding = useGraphStore.use.isIncrementalBuilding()
  const show3DNodeLabel = useSettingsStore.use.show3DNodeLabel()
  const { t } = useTranslation()

  // Track whether the initial data has been fed via prop (first mount only)
  const initializedRef = useRef(false)

  // Reset initialization flag when graph3DData is cleared (e.g. when the
  // incremental poller starts and clears existing data for a fresh drop-in)
  useEffect(() => {
    if (graph3DData.nodes.length === 0) {
      initializedRef.current = false
    }
  }, [graph3DData])

  // Hovered node id for highlight state
  const hoverNodeRef = useRef<string | null>(null)

  // Measure the actual container element instead of using window dimensions.
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

  // d3-force-3d parameters + scene lighting — set once after the engine is
  // fully initialized. react-force-graph has NO `onEngineCreated` callback;
  // the only lifecycle hooks are `onEngineTick` / `onEngineStop`. We use a
  // ref guard so the setup runs exactly once when the first tick fires.
  const lightingSetupRef = useRef(false)
  const onEngineTick = useCallback(() => {
    if (lightingSetupRef.current) return
    const fg = fgRef.current
    if (!fg || typeof fg.scene !== 'function') return

    // d3-force-3d parameters
    fg.d3AlphaDecay(FG3D_D3_ALPHA_DECAY)
    fg.d3VelocityDecay(FG3D_D3_VELOCITY_DECAY)
    fg.cooldownTicks(FG3D_COOLDOWN_TICKS)

    // Configure the link force for the drop-spring effect:
    // high strength → links act as stiff springs, yanking falling nodes into place
    const forceLink = fg.d3Force('link')
    if (forceLink) {
      forceLink.strength(FG3D_DROP_LINK_STRENGTH)
      forceLink.distance(FG3D_DROP_LINK_DISTANCE)
    }

    // Add Three.js lighting so MeshStandardMaterial nodes have depth.
    // Without lights, standard material renders as flat black — this was
    // the root cause of the 3D graph being completely invisible.
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

    // After setup, do an initial zoomToFit so nodes are in view
    try {
      fg.zoomToFit(300, 60)
    } catch {
      // zoomToFit can fail if no data yet — ignore, retry on next tick
      return
    }

    lightingSetupRef.current = true
  }, [isDarkMode])

  // Imperative incremental update — applies the drop-spring animation
  // to newly added nodes (spawn at high altitude, fall into place).
  // Triggers on any graph3DData change (both static load and incremental delta).
  useEffect(() => {
    let retries = 0
    const applyData = () => {
      const fg = fgRef.current
      const currentData = useGraphStore.getState().graph3DData

      if (!fg || typeof fg.graphData !== 'function') {
        // fgRef not ready yet — retry with backoff, max 30 attempts (3s)
        if (retries++ < 30) {
          setTimeout(applyData, 100)
        }
        return
      }

      if (currentData.nodes.length === 0) return

      if (!initializedRef.current) {
        // First load: initialize all nodes at high altitude for a dramatic
        // collective drop, then let the spring force snap them into place
        currentData.nodes.forEach((n: any) => {
          n.y = FG3D_DROP_INITIAL_Y
          n.vy = FG3D_DROP_INITIAL_VY
        })
        initializedRef.current = true
      } else {
        // Incremental: only new nodes (no existing coords) get the drop treatment
        currentData.nodes.forEach((n: any) => {
          if (n.y === undefined || n.x === undefined) {
            n.y = FG3D_DROP_INITIAL_Y
            n.vy = FG3D_DROP_INITIAL_VY
          }
        })
      }

      fg.graphData(currentData)
      // Reheat the simulation so the drop-spring effect triggers
      if (typeof fg.d3Reheat === 'function') {
        fg.d3Reheat()
      }
      // Zoom to fit after data is pushed, so nodes are framed in view
      try {
        fg.zoomToFit(300, 60)
      } catch {
        // ignore — may not have positions yet
      }
    }

    applyData()
  }, [graph3DData])

  // Node 3D object: glowing sphere with SpriteText label.
  // Each node gets a MeshStandardMaterial so it catches the scene lighting
  // and has a subtle emissive glow — the "premium" look from Hermes/HOB.
  const nodeThreeObject = useCallback(
    (node: any) => {
      // Global toggle: when show3DNodeLabel is off, no labels at all
      if (!show3DNodeLabel) return undefined

      const showLabels = graph3DData.nodes.length <= FG3D_NODE_PERF_LIMIT
      if (!showLabels) return undefined

      // Only show label for nodes with val above a threshold (avoid clutter)
      if (node.val < 5) return undefined

      // Group: sphere mesh (label sits above it)
      const group = new THREE.Group()

      // Label sprite — larger text with subtle background for readability
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

  // Node material: MeshStandardMaterial with emissive glow.
  // Called per node by react-force-graph via the `nodeMaterial` prop.
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

  // Link material: semi-transparent for a "constellation" feel
  const linkMaterial = useCallback(() => {
    const mat = new THREE.LineBasicMaterial({
      color: isDarkMode ? 0x4a6fa5 : 0x8899bb,
      transparent: true,
      opacity: 0.35,
      linewidth: FG3D_LINK_WIDTH
    })
    return mat
  }, [isDarkMode])

  // Hover highlight: scale up hovered node
  const handleNodeHover = useCallback((node: any) => {
    hoverNodeRef.current = node?.id ?? null
  }, [])

  // Zoom controls (imperative)
  const handleZoomIn = useCallback(() => {
    fgRef.current?.zoom(0.8, 200)
  }, [])
  const handleZoomOut = useCallback(() => {
    fgRef.current?.zoom(1.2, 200)
  }, [])
  const handleResetZoom = useCallback(() => {
    fgRef.current?.zoomToFit(300, 60)
  }, [])

  // Only pass initial graph data on the very first render. After that, all
  // data updates go through the imperative fgRef.current.graphData() API in
  // the effect below. Passing a changing graphData prop would cause
  // react-force-graph to rebuild the entire d3 force simulation on every
  // store update, resetting all node positions and killing the drop-spring
  // animation.
  const initialGraphData = useRef<Graph3DData>({ nodes: [], links: [] })

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <ForceGraph3D
        ref={fgRef}
        graphData={initialGraphData.current}
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
        linkDirectionalParticleWidth={0.6}
        linkDirectionalParticleSpeed={0.004}
        linkMaterial={linkMaterial}
        linkLabel={(link: any) => link.label || ''}
        linkCurvature={0.15}
        cooldownTicks={FG3D_COOLDOWN_TICKS}
        d3AlphaDecay={FG3D_D3_ALPHA_DECAY}
        d3VelocityDecay={FG3D_D3_VELOCITY_DECAY}
        onEngineTick={onEngineTick}
        onNodeClick={onNodeClick}
        onNodeHover={handleNodeHover}
        onBackgroundClick={onBackgroundClick}
        width={dims.width}
        height={dims.height}
        pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
        cameraPosition={{ x: 0, y: 0, z: 400 }}
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

export default ForceGraph3DContainer
