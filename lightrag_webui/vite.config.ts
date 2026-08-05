import { defineConfig, loadEnv, type Plugin } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Use relative imports here. The '@' alias is configured in resolve.alias
// below and only takes effect during bundling — Node cannot resolve it when
// loading vite.config.ts. Bun resolves tsconfig paths natively, masking the
// issue, but Node does not.
import { normalizeApiPrefix, normalizeWebuiPrefix } from './src/lib/pathPrefix'

/**
 * Inject `<script>window.__LIGHTRAG_CONFIG__ = ...</script>` into index.html.
 *
 * This mirrors what the FastAPI server does at request time in production
 * (see `SmartStaticFiles._inject_runtime_config` in
 * `lightrag/api/lightrag_server.py`). Doing it in dev too means the SPA
 * always reads its prefix the same way, so behaviour matches between
 * `bun run dev` and a production deploy.
 *
 * Only `VITE_DEV_API_PREFIX` is read; the WebUI mount path is fixed at
 * `/webui` (matching the backend's hardcoded `WEBUI_PATH`), so the
 * injected `webuiPrefix` follows the production formula
 * `apiPrefix + "/webui/"` automatically.
 */
function lightragRuntimeConfigPlugin(env: Record<string, string>): Plugin {
  const apiPrefix = normalizeApiPrefix(env.VITE_DEV_API_PREFIX)
  const webuiPrefix = normalizeWebuiPrefix(apiPrefix ? `${apiPrefix}/webui/` : '')
  const payload = JSON.stringify({ apiPrefix, webuiPrefix }).replace(
    /<\//g,
    '<\\/'
  )
  const snippet = `<script>window.__LIGHTRAG_CONFIG__ = ${payload};</script>`

  return {
    name: 'lightrag-dev-runtime-config',
    apply: 'serve',
    transformIndexHtml(html: string) {
      return html.replace('<!-- __LIGHTRAG_RUNTIME_CONFIG__ -->', snippet)
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Dev-only: prefix every proxied endpoint with the simulated site
  // prefix so e.g. `/site01/documents/...` is forwarded to the backend
  // running with LIGHTRAG_API_PREFIX=/site01.
  const devApiPrefix = normalizeApiPrefix(env.VITE_DEV_API_PREFIX)

  return {
    plugins: [react(), tailwindcss(), lightragRuntimeConfigPlugin(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // react-force-graph's ESM bundle imports 3d-force-graph-vr and
        // 3d-force-graph-ar, which pull in AFRAME (a WebXR framework) via
        // aframe-extras. AFRAME references the global `AFRAME` at module
        // top-level, causing `ReferenceError: AFRAME is not defined` in dev.
        // We never use VR/AR mode — only ForceGraph3D from 3d-force-graph —
        // so stub these two packages to a no-op kapsule (returns a dummy
        // component) and AFRAME never loads.
        '3d-force-graph-vr': path.resolve(__dirname, './src/stubs/emptyKapsule.ts'),
        '3d-force-graph-ar': path.resolve(__dirname, './src/stubs/emptyKapsule.ts')
      },
      // Force all modules to use the same katex instance
      // This ensures mhchem extension registered in main.tsx is available to rehype-katex
      dedupe: ['katex']
    },
    // Relative base: asset URLs in index.html become `./assets/...` so the
    // built bundle works under any reverse-proxy mount point. The browser
    // resolves them against the current document URL — which means the
    // server MUST serve index.html at a URL ending in '/' (the existing
    // /webui → /webui/ redirect already handles this).
    base: './',
    build: {
      outDir: path.resolve(__dirname, '../lightrag/api/webui'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 3800,
      rollupOptions: {
        // Let Vite handle chunking automatically to avoid circular dependency issues
        output: {
          // Ensure consistent chunk naming format
          chunkFileNames: 'assets/[name]-[hash].js',
          // Entry file naming format
          entryFileNames: 'assets/[name]-[hash].js',
          // Asset file naming format
          assetFileNames: 'assets/[name]-[hash].[ext]'
        }
      }
    },
    server: {
      proxy: env.VITE_API_PROXY === 'true' && env.VITE_API_ENDPOINTS ?
        Object.fromEntries(
          env.VITE_API_ENDPOINTS.split(',').map(endpoint => [
            devApiPrefix + endpoint,
            {
              target: env.VITE_BACKEND_URL || 'http://localhost:9621',
              changeOrigin: true
              // No rewrite: the backend already understands its own prefix
              // via FastAPI's root_path, so forward the path verbatim.
            }
          ])
        ) : {}
    },
    optimizeDeps: {
      // react-force-graph ships both CJS (.js, with AFRAME VR references that
      // ReferenceError in dev) and ESM (.mjs) bundles. Vite's dep pre-bundler
      // may pick the CJS entry and try to evaluate it, hitting `AFRAME is not
      // defined`. Forcing the ESM entry avoids the AFRAME code path entirely.
      // three-spritetext is pulled in transitively and needs the same treatment.
      include: ['react-force-graph', 'three-spritetext']
    }
  }
})
