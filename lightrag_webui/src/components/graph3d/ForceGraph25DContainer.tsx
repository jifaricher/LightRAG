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
  FG3D_NODE_PERF_LIMIT,
  FG3D25D_FORCE_Z_STRENGTH,
  FG3D25D_DROP_INITIAL_Z,
  FG3D25D_DROP_INITIAL_VZ,
  FG3D25D_DROP_LINK_STRENGTH,
  FG3D25D_DROP_LINK_DISTANCE,
  FG3D25D_DROP_LINK_DISTANCE_START,
  FG3D25D_DROP_EDGE_RADIUS,
  FG3D_DROP_RADIUS_SCALE,
  FG3D_DROP_Z_SCALE,
  FG3D25D_CHARGE_STRENGTH,
  FG3D25D_CAMERA_POSITION,
  controlButtonVariant
} from '@/lib/constants'
import useIsDarkMode from '@/hooks/useIsDarkMode'
import Button from '@/components/ui/Button'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

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

// Shared material caches (shared with ForceGraph3DContainer via module scope is fine;
// we duplicate here to keep components independent.)
const nodeMatCache = new Map<string, THREE.MeshStandardMaterial>()
function getNodeMaterial(colorHex: string, isHub: boolean) {
  const key = `${colorHex}|${isHub ? 'hub' : 'n'}`
  let mat = nodeMatCache.get(key)
  if (mat) return mat
  const rgb = hexToRgb(colorHex || '#ffffff')
  mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(1, 1, 1),
    emissive: new THREE.Color(rgb.r, rgb.g, rgb.b),
    emissiveIntensity: isHub ? 2.8 : 1.4,
    metalness: 0.0,
    roughness: 0.2,
    transparent: true,
    opacity: 1.0
  })
  nodeMatCache.set(key, mat)
  return mat
}

const linkMatCache = new Map<string, THREE.LineBasicMaterial>()
function getLinkMaterial(dark: boolean) {
  const key = dark ? 'd' : 'l'
  let mat = linkMatCache.get(key)
  if (mat) return mat
  mat = new THREE.LineBasicMaterial({
    color: dark ? 0x8899bb : 0xaabbdd,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
  linkMatCache.set(key, mat)
  return mat
}

/**
 * 2.5D force-graph wrapper — same Hermes constellation/neural-net visual treatment
 * as ForceGraph3DContainer, but with a forceZ(0) constraint that pulls nodes onto
 * a flat plane so the steady state reads like a glowing 2D network.
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
  const hoverNodeRef = useRef<string | null>(null)

  // Post-processing
  const composerRef = useRef<EffectComposer | null>(null)
  const bloomPassRef = useRef<UnrealBloomPass | null>(null)
  const postFxSetupRef = useRef(false)
  const origRenderRef = useRef<THREE.WebGLRenderer['render'] | null>(null)
  const fxClockRef = useRef<THREE.Clock>(new THREE.Clock())

  useEffect(() => {
    return () => { delete (window as any).__forceGraph3DRef }
  }, [])

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

  const setupPostFx = useCallback(() => {
    const fg = fgRef.current
    if (!fg || postFxSetupRef.current) return
    const renderer = fg.renderer?.()
    const scene = fg.scene?.()
    const camera = fg.camera?.()
    if (!renderer || !scene || !camera) return

    const w = renderer.domElement.clientWidth || dims.width
    const h = renderer.domElement.clientHeight || dims.height

    const composer = new EffectComposer(renderer)
    composer.setSize(w, h)
    composer.addPass(new RenderPass(scene, camera))

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      1.2,
      0.6,
      0.15
    )
    composer.addPass(bloom)
    composerRef.current = composer
    bloomPassRef.current = bloom

    if (!origRenderRef.current) {
      const orig = renderer.render.bind(renderer)
      origRenderRef.current = orig
      renderer.render = (sceneObj: THREE.Object3D, cam: THREE.Camera) => {
        orig(sceneObj, cam)
        composer.render(fxClockRef.current.getDelta())
      }
      const origSetSize = renderer.setSize.bind(renderer)
      renderer.setSize = (w0: number, h0: number, updateStyle?: boolean) => {
        origSetSize(w0, h0, updateStyle)
        composer.setSize(w0, h0)
        bloom.setSize(w0, h0)
      }
    }

    postFxSetupRef.current = true
  }, [dims.width, dims.height])

  const lightingSetupRef = useRef(false)
  const onEngineTick = useCallback(() => {
    const fg = fgRef.current
    if (!fg || typeof fg.scene !== 'function') return

    if (!(window as any).__forceGraph3DRef) {
      ;(window as any).__forceGraph3DRef = fg
    }

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

      fg.d3Force('z', forceZ(0).strength(FG3D25D_FORCE_Z_STRENGTH))

      const scene = fg.scene()
      if (scene) {
        scene.add(new THREE.AmbientLight(0xaabbff, 0.45))
        const key = new THREE.PointLight(0xffffff, 0.6, 0, 2)
        key.position.set(0, 0, 500)
        scene.add(key)
      }

      lightingSetupRef.current = true
    }

    setupPostFx()

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
  }, [setupPostFx])

  useEffect(() => {
    if (graph3DData.nodes.length === 0) {
      initializedRef.current = false
    }
  }, [graph3DData])

  useEffect(() => {
    const currentData = useGraphStore.getState().graph3DData
    if (currentData.nodes.length === 0) return

    const isFirstLoad = !initializedRef.current

    if (isFirstLoad) {
      currentData.nodes.forEach((n: any) => {
        n.z = FG3D25D_DROP_INITIAL_Z
        n.vz = FG3D25D_DROP_INITIAL_VZ
      })
      initializedRef.current = true
    } else {
      let cx = 0, cy = 0, count = 0
      for (const n of currentData.nodes) {
        if (n.x !== undefined && n.y !== undefined) {
          cx += n.x
          cy += n.y
          count++
        }
      }
      if (count > 0) { cx /= count; cy /= count }

      const fg = fgRef.current
      let spawnRadius = FG3D25D_DROP_EDGE_RADIUS
      let dropZ = FG3D25D_DROP_INITIAL_Z
      if (fg && typeof fg.getGraphBbox === 'function') {
        const bbox = fg.getGraphBbox()
        if (bbox) {
          const bboxW = bbox.x[1] - bbox.x[0]
          const bboxH = bbox.y[1] - bbox.y[0]
          const extent = Math.max(bboxW, bboxH)
          spawnRadius = Math.max(extent * FG3D_DROP_RADIUS_SCALE, FG3D25D_DROP_EDGE_RADIUS)
          dropZ = Math.max(extent * FG3D_DROP_Z_SCALE, FG3D25D_DROP_INITIAL_Z)
        }
      }

      let angleIdx = 0
      currentData.nodes.forEach((n: any) => {
        if (n.x !== undefined && n.y !== undefined) {
          n.fx = n.x
          n.fy = n.y
          n.fz = 0
          n.vx = 0
          n.vy = 0
          n.vz = 0
        } else {
          const angle = (angleIdx * 137.5) * Math.PI / 180
          angleIdx++
          n.x = cx + spawnRadius * Math.cos(angle)
          n.y = cy + spawnRadius * Math.sin(angle)
          n.z = dropZ
          n.vx = 0
          n.vy = 0
          n.vz = FG3D25D_DROP_INITIAL_VZ
        }
      })
    }

    const fg = fgRef.current
    if (fg) {
      if (typeof fg.d3ReheatSimulation === 'function') {
        fg.d3ReheatSimulation()
      }
    }
  }, [graph3DData])

  const nodeThreeObject = useCallback(
    (node: any) => {
      if (!show3DNodeLabel) return hiddenGroup()
      const showLabels = graph3DData.nodes.length <= FG3D_NODE_PERF_LIMIT
      if (!showLabels) return hiddenGroup()
      if ((node.val ?? 1) < 8) return hiddenGroup()
      const group = new THREE.Group()
      const label = node.label || node.name || node.id
      const sprite = new SpriteText(label, 12, '#ffffff')
      sprite.textHeight = 6
      sprite.padding = 2
      sprite.backgroundColor = 'rgba(0,0,0,0.55)'
      sprite.borderRadius = 2
      sprite.position.y = 6
      group.add(sprite)
      return group
    },
    [graph3DData.nodes.length, show3DNodeLabel]
  )

  const nodeMaterial = useCallback((node: any) => {
    const isHub = (node.val ?? 1) >= 8
    return getNodeMaterial(node.color || '#ffffff', isHub)
  }, [])

  const nodeVal = useCallback((node: any) => {
    const v = node.val ?? 1
    if (v >= 10) return v * 1.6
    if (v >= 5) return v * 1.2
    return v * 0.7
  }, [])

  // Hidden placeholder group returned when we don't want a label attached
  const hiddenGroupRef = useRef<THREE.Group | null>(null)
  const hiddenGroup = () => {
    if (!hiddenGroupRef.current) {
      const g = new THREE.Group()
      g.visible = false
      hiddenGroupRef.current = g
    }
    return hiddenGroupRef.current
  }

  const linkMaterial = useCallback(() => getLinkMaterial(isDarkMode), [isDarkMode])

  const handleNodeHover = useCallback((node: any) => {
    hoverNodeRef.current = node?.id ?? null
  }, [])

  const onEngineStop = useCallback(() => {
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

  useEffect(() => {
    return () => {
      const fg = fgRef.current
      if (fg && origRenderRef.current) {
        const renderer = fg.renderer?.()
        if (renderer) renderer.render = origRenderRef.current
        origRenderRef.current = null
      }
      if (composerRef.current) {
        composerRef.current.dispose()
        composerRef.current = null
      }
      postFxSetupRef.current = false
      bloomPassRef.current = null
    }
  }, [])

  const FG3D = ForceGraph3D as any

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <FG3D
        ref={fgRef}
        graphData={graph3DData}
        backgroundColor="#000008"
        nodeColor={() => '#ffffff'}
        nodeRelSize={FG3D_NODE_REL_SIZE * 0.7}
        nodeVal={nodeVal}
        nodeLabel={(node: any) => node.label || node.name || node.id}
        nodeMaterial={nodeMaterial}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={true}
        nodeOpacity={1}
        linkColor={() => (isDarkMode ? '#6688bb' : '#99bbff')}
        linkWidth={0.3}
        linkDirectionalParticles={0}
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
        pixelRatio={Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2)}
        cameraPosition={FG3D25D_CAMERA_POSITION}
        enableNodeDrag={true}
        showNavHint={false}
      />

      {/* Zoom controls — bottom-left */}
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
