import { useCallback, useState } from 'react'
import Button from '@/components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/Command'
import { controlButtonVariant, FG3D_DROP_INITIAL_Z, FG3D_DROP_INITIAL_VZ } from '@/lib/constants'
import { packHierarchy } from '@/lib/circlepack'
import { useGraphStore } from '@/stores/graph'
import { GripIcon, PlayIcon, PauseIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type LayoutName = 'Force Atlas' | 'Circular' | 'Circlepack' | 'Random' | 'Noverlaps'

/**
 * d3-force layout control for 3D / 2.5D force-graph views.
 *
 * Unlike the 2D LayoutsControl (which uses graphology supervisors via sigma),
 * this component interacts with the d3-force-3d simulation exposed by
 * react-force-graph's ref API: fg.d3Force() to read/modify forces, and
 * fg.d3ReheatSimulation() to restart.
 *
 * Layouts:
 * - Force Atlas: default d3 force layout (link + charge + center), reheated
 * - Circular: nodes placed on a circle in XY, simulation frozen
 * - Random: nodes scattered randomly, simulation frozen
 * - Noverlaps: stronger charge repulsion to push overlaps apart
 *
 * The component finds the active ForceGraph3D instance by querying the DOM
 * for the container element and accessing the ref stored on it.
 */
const LayoutsControl3D = () => {
  const { t } = useTranslation()
  const [layout, setLayout] = useState<LayoutName>('Force Atlas')
  const [opened, setOpened] = useState(false)
  const [running, setRunning] = useState(false)

  // Get the ForceGraph3D instance — the container component stores its ref
  // on the DOM element via a data attribute or we access it through the
  // global store. Since the ref is internal to the container, we use
  // a shared approach: the container registers its ref on window for
  // external controls.
  const getFg = useCallback(() => {
    return (window as any).__forceGraph3DRef
  }, [])

  const applyCircular = useCallback(() => {
    const fg = getFg()
    if (!fg) return
    const data = useGraphStore.getState().graph3DData
    const n = data.nodes.length
    const radius = Math.max(100, n * 4)
    data.nodes.forEach((node: any, i: number) => {
      const angle = (2 * Math.PI * i) / n
      // Lock XY target, release fz so node drops from high z to plane
      node.fx = Math.cos(angle) * radius
      node.fy = Math.sin(angle) * radius
      delete node.fz
      node.z = FG3D_DROP_INITIAL_Z
      node.vz = FG3D_DROP_INITIAL_VZ
      node.vx = 0
      node.vy = 0
    })
    if (typeof fg.d3ReheatSimulation === 'function') {
      fg.d3ReheatSimulation()
    }
    // Fit camera so nodes are clearly visible
    if (typeof fg.zoomToFit === 'function') {
      setTimeout(() => fg.zoomToFit(300, 60), 100)
    }
    setRunning(false)
  }, [getFg])

  const applyCirclepack = useCallback(() => {
    const fg = getFg()
    if (!fg) return
    const data = useGraphStore.getState().graph3DData
    const { nodes, links } = data

    // Union-Find to find connected components (clusters)
    const parent = new Map<string, string>()
    nodes.forEach((n: any) => parent.set(String(n.id), String(n.id)))
    const find = (x: string): string => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!)
        x = parent.get(x)!
      }
      return x
    }
    const union = (a: string, b: string) => {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
    links.forEach((l: any) => union(String(l.source), String(l.target)))

    // Group nodes by cluster root
    const clusterMap = new Map<string, any[]>()
    nodes.forEach((n: any) => {
      const root = find(String(n.id))
      if (!clusterMap.has(root)) clusterMap.set(root, [])
      clusterMap.get(root)!.push(n)
    })

    // Build cluster input for packHierarchy
    const clusterInput = Array.from(clusterMap.entries()).map(([root, clusterNodes]) => ({
      id: root,
      nodes: clusterNodes.map((n: any) => ({
        id: String(n.id),
        // Node radius: based on val (connection count), fallback to 1.
        // Matches graphology circlepack which uses `size` attr or 1.
        // Using sqrt for visual scaling (like d3-hierarchy's defaultRadius).
        r: Math.max(1, Math.sqrt(n.val || 1))
      }))
    }))

    // Run d3-hierarchy pack algorithm: tight non-overlapping circles
    const packedClusters = packHierarchy(clusterInput)

    // Apply positions: scale up the packed coordinates for 3D visibility
    const scale = 8
    const nodeById = new Map<string, any>()
    nodes.forEach((n: any) => nodeById.set(String(n.id), n))

    packedClusters.forEach((cluster) => {
      cluster.nodes.forEach((pn) => {
        const node = nodeById.get(pn.id)
        if (node) {
          // Lock XY target, release fz so node drops from high z to plane
          node.fx = pn.x * scale
          node.fy = pn.y * scale
          delete node.fz
          node.z = FG3D_DROP_INITIAL_Z
          node.vz = FG3D_DROP_INITIAL_VZ
          node.vx = 0
          node.vy = 0
        }
      })
    })

    if (typeof fg.d3ReheatSimulation === 'function') {
      fg.d3ReheatSimulation()
    }
    // Fit the camera to the laid-out graph so nodes are clearly visible
    if (typeof fg.zoomToFit === 'function') {
      setTimeout(() => fg.zoomToFit(300, 60), 100)
    }
    setRunning(false)
  }, [getFg])

  const applyRandom = useCallback(() => {
    const fg = getFg()
    if (!fg) return
    const data = useGraphStore.getState().graph3DData
    data.nodes.forEach((node: any) => {
      // Lock XY target, release fz so node drops from high z to plane
      node.fx = (Math.random() - 0.5) * 600
      node.fy = (Math.random() - 0.5) * 600
      delete node.fz
      node.z = FG3D_DROP_INITIAL_Z
      node.vz = FG3D_DROP_INITIAL_VZ
      node.vx = 0
      node.vy = 0
    })
    if (typeof fg.d3ReheatSimulation === 'function') {
      fg.d3ReheatSimulation()
    }
    setRunning(false)
  }, [getFg])

  const applyForceAtlas = useCallback(() => {
    const fg = getFg()
    if (!fg) return
    // Clear all fx/fy/fz pins so nodes are free to move
    const data = useGraphStore.getState().graph3DData
    data.nodes.forEach((node: any) => {
      delete node.fx
      delete node.fy
      delete node.fz
    })
    // Reset link and charge to default values
    const forceLink = fg.d3Force('link')
    if (forceLink) {
      forceLink.strength(0.2)
      forceLink.distance(30)
    }
    const forceCharge = fg.d3Force('charge')
    if (forceCharge) {
      forceCharge.strength(-15)
    }
    if (typeof fg.d3ReheatSimulation === 'function') {
      fg.d3ReheatSimulation()
    }
    setRunning(true)
  }, [getFg])

  const applyNoverlaps = useCallback(() => {
    const fg = getFg()
    if (!fg) return
    // Clear pins and boost charge repulsion to push overlaps apart
    const data = useGraphStore.getState().graph3DData
    data.nodes.forEach((node: any) => {
      delete node.fx
      delete node.fy
      delete node.fz
    })
    const forceCharge = fg.d3Force('charge')
    if (forceCharge) {
      forceCharge.strength(-80)
    }
    if (typeof fg.d3ReheatSimulation === 'function') {
      fg.d3ReheatSimulation()
    }
    setRunning(true)
  }, [getFg])

  const runLayout = useCallback(
    (newLayout: LayoutName) => {
      switch (newLayout) {
        case 'Circular':
          applyCircular()
          break
        case 'Circlepack':
          applyCirclepack()
          break
        case 'Random':
          applyRandom()
          break
        case 'Force Atlas':
          applyForceAtlas()
          break
        case 'Noverlaps':
          applyNoverlaps()
          break
      }
      setLayout(newLayout)
      setOpened(false)
    },
    [applyCircular, applyCirclepack, applyRandom, applyForceAtlas, applyNoverlaps]
  )

  const toggleRunning = useCallback(() => {
    if (running) {
      // Stop: pin all nodes in place
      const fg = getFg()
      if (fg) {
        const data = useGraphStore.getState().graph3DData
        data.nodes.forEach((node: any) => {
          if (node.x !== undefined) {
            node.fx = node.x
            node.fy = node.y
            node.fz = node.z ?? 0
            node.vx = 0
            node.vy = 0
            node.vz = 0
          }
        })
      }
      setRunning(false)
    } else {
      // Resume: clear pins and reheat
      if (layout === 'Force Atlas') {
        applyForceAtlas()
      } else if (layout === 'Noverlaps') {
        applyNoverlaps()
      } else {
        // For Circular/Random, just reheat without changing positions
        const fg = getFg()
        if (fg && typeof fg.d3ReheatSimulation === 'function') {
          const data = useGraphStore.getState().graph3DData
          data.nodes.forEach((node: any) => {
            delete node.fx
            delete node.fy
            delete node.fz
          })
          fg.d3ReheatSimulation()
        }
        setRunning(true)
      }
    }
  }, [running, layout, getFg, applyForceAtlas, applyNoverlaps])

  const allLayoutNames: LayoutName[] = ['Force Atlas', 'Circular', 'Circlepack', 'Random', 'Noverlaps']

  // Show play/pause only for relaxing layouts
  const isRelaxingLayout = layout === 'Force Atlas' || layout === 'Noverlaps'

  return (
    <div className="flex flex-col">
      {isRelaxingLayout && (
        <Button
          size="icon"
          onClick={toggleRunning}
          tooltip={
            running
              ? t('graphPanel.sideBar.layoutsControl.stopAnimation')
              : t('graphPanel.sideBar.layoutsControl.startAnimation')
          }
          variant={controlButtonVariant}
        >
          {running ? <PauseIcon /> : <PlayIcon />}
        </Button>
      )}
      <Popover open={opened} onOpenChange={setOpened}>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant={controlButtonVariant}
            onClick={() => setOpened((e: boolean) => !e)}
            tooltip={t('graphPanel.sideBar.layoutsControl.layoutGraph')}
          >
            <GripIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={5}
          sticky="always"
          className="min-w-auto p-1"
        >
          <Command>
            <CommandList>
              <CommandGroup>
                {allLayoutNames.map((name) => (
                  <CommandItem
                    onSelect={() => runLayout(name)}
                    key={name}
                    className="cursor-pointer text-xs"
                  >
                    {t(`graphPanel.sideBar.layoutsControl.layouts.${name}`)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default LayoutsControl3D
