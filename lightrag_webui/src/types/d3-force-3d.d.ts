declare module 'd3-force-3d' {
  export function forceX(x?: number | ((d: any, i: number, data: any[]) => number)): any
  export function forceY(y?: number | ((d: any, i: number, data: any[]) => number)): any
  export function forceZ(z?: number | ((d: any, i: number, data: any[]) => number)): any
  export function forceLink(links?: any[], id?: (d: any) => any): any
  export function forceManyBody(): any
  export function forceCenter(x?: number, y?: number, z?: number): any
  export function forceRadial(radius?: number, x?: number, y?: number, z?: number): any
  export function forceSimulation(nodes?: any[], numDimensions?: number): any
}
