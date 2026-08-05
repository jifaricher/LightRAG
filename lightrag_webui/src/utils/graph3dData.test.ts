import { describe, test, expect } from 'bun:test'
import { rawGraphTo3DData, apiResponseTo3DData, diffIntoGraphData, initKnownIds } from './graph3dData'
import type { RawGraph, Graph3DData } from '@/stores/graph'
import type { LightragGraphType } from '@/api/lightrag'

describe('graph3dData', () => {
  const mockRawGraph: RawGraph = {
    nodes: [
      { id: 'n1', labels: ['Entity1'], properties: { entity_type: 'person' }, size: 10, x: 0, y: 0, color: '', degree: 2 },
      { id: 'n2', labels: ['Entity2'], properties: { entity_type: 'organization' }, size: 15, x: 1, y: 1, color: '', degree: 3 }
    ],
    edges: [
      { id: 'n1-n2', source: 'n1', target: 'n2', properties: { keywords: 'works_at', weight: 2 }, dynamicId: '' }
    ],
    nodeIdMap: {},
    edgeIdMap: {},
    edgeDynamicIdMap: {},
    getNode: () => undefined,
    getEdge: () => undefined,
    buildDynamicMap: () => {}
  } as any

  describe('rawGraphTo3DData', () => {
    test('converts raw graph to 3D format with colors and sizes', () => {
      const { data, updatedColorMap } = rawGraphTo3DData(mockRawGraph)
      expect(data.nodes).toHaveLength(2)
      expect(data.links).toHaveLength(1)
      expect(data.nodes[0].id).toBe('n1')
      expect(data.nodes[0].name).toBe('Entity1')
      expect(data.nodes[0].val).toBe(10)
      expect(data.nodes[0].color).toBeDefined()
      // No x/y/z — react-force-graph initializes new nodes
      expect(data.nodes[0].x).toBeUndefined()
      expect(data.links[0].source).toBe('n1')
      expect(data.links[0].target).toBe('n2')
      expect(data.links[0].width).toBe(2)
      expect(data.links[0].label).toBe('works_at')
      expect(updatedColorMap.size).toBeGreaterThan(0)
    })

    test('handles null input', () => {
      const { data } = rawGraphTo3DData(null)
      expect(data.nodes).toHaveLength(0)
      expect(data.links).toHaveLength(0)
    })

    test('falls back to id when labels missing', () => {
      const badRaw: RawGraph = {
        nodes: [{ id: 'n3', labels: null as any, properties: {}, size: 5, x: 0, y: 0, color: '', degree: 0 }],
        edges: [],
        nodeIdMap: {},
        edgeIdMap: {},
        edgeDynamicIdMap: {},
        getNode: () => undefined,
        getEdge: () => undefined,
        buildDynamicMap: () => {}
      } as any
      const { data } = rawGraphTo3DData(badRaw)
      expect(data.nodes[0].name).toBe('n3')
    })
  })

  describe('apiResponseTo3DData', () => {
    test('computes degree and size from raw API response', () => {
      const apiResp: LightragGraphType = {
        nodes: [
          { id: 'a', labels: ['A'], properties: { entity_type: 'person' } },
          { id: 'b', labels: ['B'], properties: { entity_type: 'person' } },
          { id: 'c', labels: ['C'], properties: { entity_type: 'location' } }
        ],
        edges: [
          { id: 'a-b', source: 'a', target: 'b', type: 'DIRECTED', properties: { weight: 1 } },
          { id: 'a-c', source: 'a', target: 'c', type: 'DIRECTED', properties: {} }
        ]
      }
      const { data } = apiResponseTo3DData(apiResp)
      expect(data.nodes).toHaveLength(3)
      expect(data.links).toHaveLength(2)
      // Node 'a' has degree 2 (most connected), should have larger size
      const nodeA = data.nodes.find((n) => n.id === 'a')!
      const nodeB = data.nodes.find((n) => n.id === 'b')!
      expect(nodeA.val).toBeGreaterThanOrEqual(nodeB.val)
    })
  })

  describe('diffIntoGraphData', () => {
    test('preserves existing node coordinates on diff', () => {
      const prevData: Graph3DData = {
        nodes: [
          { id: 'n1', name: 'E1', color: '#4169E1', val: 10, x: 100, y: 200, z: 50, vx: 0.1, vy: 0.2, vz: 0, properties: {} },
          { id: 'n2', name: 'E2', color: '#00cc00', val: 15, x: 10, y: 20, z: 5, properties: {} }
        ],
        links: [{ source: 'n1', target: 'n2', width: 1, properties: {} }]
      }
      const knownNodeIds = new Set(['n1', 'n2'])
      const knownEdgeIds = new Set(['n1-n2'])

      const apiResp: LightragGraphType = {
        nodes: [
          { id: 'n1', labels: ['E1'], properties: { entity_type: 'person', description: 'updated' } },
          { id: 'n2', labels: ['E2'], properties: { entity_type: 'organization' } },
          { id: 'n3', labels: ['E3'], properties: { entity_type: 'location' } }
        ],
        edges: [
          { id: 'n1-n2', source: 'n1', target: 'n2', type: 'DIRECTED', properties: { weight: 3 } },
          { id: 'n2-n3', source: 'n2', target: 'n3', type: 'DIRECTED', properties: {} }
        ]
      }

      const { merged, newNodes, newEdges } = diffIntoGraphData(prevData, apiResp, knownNodeIds, knownEdgeIds)

      expect(merged.nodes).toHaveLength(3)
      expect(merged.links).toHaveLength(2)
      expect(newNodes).toBe(1)
      expect(newEdges).toBe(1)

      // Existing node n1 keeps its coordinates
      const n1 = merged.nodes.find((n) => n.id === 'n1')!
      expect(n1.x).toBe(100)
      expect(n1.y).toBe(200)
      expect(n1.z).toBe(50)
      expect(n1.vx).toBe(0.1)
      // Properties updated
      expect(n1.properties?.description).toBe('updated')

      // New node n3 has no coordinates
      const n3 = merged.nodes.find((n) => n.id === 'n3')!
      expect(n3.x).toBeUndefined()
      expect(n3.y).toBeUndefined()
      expect(n3.z).toBeUndefined()
    })

    test('reports zero delta when no new nodes/edges', () => {
      const prevData: Graph3DData = {
        nodes: [{ id: 'n1', name: 'E1', color: '#4169E1', val: 10, properties: {} }],
        links: []
      }
      const knownNodeIds = new Set(['n1'])
      const knownEdgeIds = new Set<string>()

      const apiResp: LightragGraphType = {
        nodes: [{ id: 'n1', labels: ['E1'], properties: { entity_type: 'person' } }],
        edges: []
      }

      const { newNodes, newEdges } = diffIntoGraphData(prevData, apiResp, knownNodeIds, knownEdgeIds)
      expect(newNodes).toBe(0)
      expect(newEdges).toBe(0)
    })

    test('handles empty response', () => {
      const prevData: Graph3DData = { nodes: [], links: [] }
      const knownNodeIds = new Set<string>()
      const knownEdgeIds = new Set<string>()
      const apiResp: LightragGraphType = { nodes: [], edges: [] }

      const { merged, newNodes, newEdges } = diffIntoGraphData(prevData, apiResp, knownNodeIds, knownEdgeIds)
      expect(merged.nodes).toHaveLength(0)
      expect(merged.links).toHaveLength(0)
      expect(newNodes).toBe(0)
      expect(newEdges).toBe(0)
    })

    test('preserves fx/fy/fz (user-dragged fixed positions)', () => {
      const prevData: Graph3DData = {
        nodes: [{ id: 'n1', name: 'E1', color: '#4169E1', val: 10, fx: 5, fy: 10, fz: 15, properties: {} }],
        links: []
      }
      const knownNodeIds = new Set(['n1'])
      const knownEdgeIds = new Set<string>()
      const apiResp: LightragGraphType = {
        nodes: [{ id: 'n1', labels: ['E1'], properties: { entity_type: 'person' } }],
        edges: []
      }
      const { merged } = diffIntoGraphData(prevData, apiResp, knownNodeIds, knownEdgeIds)
      expect(merged.nodes[0].fx).toBe(5)
      expect(merged.nodes[0].fy).toBe(10)
      expect(merged.nodes[0].fz).toBe(15)
    })
  })

  describe('initKnownIds', () => {
    test('builds id sets from existing 3D data', () => {
      const data: Graph3DData = {
        nodes: [
          { id: 'a', name: 'A', color: '#fff', val: 5 },
          { id: 'b', name: 'B', color: '#fff', val: 5 }
        ],
        links: [{ source: 'a', target: 'b', width: 1 }]
      }
      const { nodeIds, edgeIds } = initKnownIds(data)
      expect(nodeIds.has('a')).toBe(true)
      expect(nodeIds.has('b')).toBe(true)
      expect(edgeIds.has('a-b')).toBe(true)
    })

    test('handles links with object source/target (after d3-force processes them)', () => {
      const data: Graph3DData = {
        nodes: [
          { id: 'a', name: 'A', color: '#fff', val: 5 },
          { id: 'b', name: 'B', color: '#fff', val: 5 }
        ],
        links: [{ source: { id: 'a' } as any, target: { id: 'b' } as any, width: 1 }]
      }
      const { edgeIds } = initKnownIds(data)
      expect(edgeIds.has('a-b')).toBe(true)
    })
  })
})
