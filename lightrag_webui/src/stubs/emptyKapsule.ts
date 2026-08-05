// Stub for 3d-force-graph-vr / 3d-force-graph-ar.
//
// react-force-graph's ESM bundle imports these packages, which transitively
// load AFRAME (a WebXR framework). AFRAME references the global `AFRAME`
// variable at module top-level, causing `ReferenceError: AFRAME is not
// defined` in the browser. We never use VR/AR mode — only the standard
// ForceGraph3D component — so stub these imports with a no-op kapsule.
//
// react-kapsule calls the factory and expects a React component back.
const noopComponent = () => null
export default () => noopComponent
