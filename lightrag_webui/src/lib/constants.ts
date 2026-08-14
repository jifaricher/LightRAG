import { ButtonVariantType } from '@/components/ui/Button'
import { normalizeApiPrefix, normalizeWebuiPrefix } from '@/lib/pathPrefix'
import { getRuntimeApiPrefix, getRuntimeWebuiPrefix } from '@/lib/runtimeConfig'

export const backendBaseUrl = normalizeApiPrefix(getRuntimeApiPrefix())
export const webuiPrefix = normalizeWebuiPrefix(getRuntimeWebuiPrefix())

export const controlButtonVariant: ButtonVariantType = 'ghost'

export const labelColorDarkTheme = '#FFFFFF'
export const LabelColorHighlightedDarkTheme = '#000000'
export const labelColorLightTheme = '#000'

export const nodeColorDisabled = '#E2E2E2'
export const nodeBorderColor = '#EEEEEE'
export const nodeBorderColorSelected = '#F57F17'

export const edgeColorDarkTheme = '#888888'
export const edgeColorSelected = '#F57F17'
export const edgeColorHighlightedDarkTheme = '#F57F17'
export const edgeColorHighlightedLightTheme = '#F57F17'

export const searchResultLimit = 50
export const labelListLimit = 100

// Search History Configuration
export const searchHistoryMaxItems = 500
export const searchHistoryVersion = '1.0'

// API Request Limits
export const popularLabelsDefaultLimit = 300
export const searchLabelsDefaultLimit = 50

// UI Display Limits
export const dropdownDisplayLimit = 300

export const minNodeSize = 4
export const maxNodeSize = 20

export const healthCheckInterval = 15 // seconds

export const defaultQueryLabel = '*'

// reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/MIME_types/Common_types
export const supportedFileTypes = {
  'text/plain': [
    '.txt',
    '.md',
    '.textpack', // # Markdown Bundle(zip)
    '.mdx', // # MDX (Markdown + JSX)
    '.rtf', // # Rich Text Format
    '.odt', // # OpenDocument Text
    '.tex', // # LaTeX
    '.epub', // # Electronic Publication
    '.html', // # HyperText Markup Language
    '.htm', // # HyperText Markup Language
    '.csv', // # Comma-Separated Values
    '.json', // # JavaScript Object Notation
    '.xml', // # eXtensible Markup Language
    '.yaml', // # YAML Ain't Markup Language
    '.yml', // # YAML
    '.log', // # Log files
    '.conf', // # Configuration files
    '.ini', // # Initialization files
    '.properties', // # Java properties files
    '.sql', // # SQL scripts
    '.bat', // # Batch files
    '.sh', // # Shell scripts
    '.c', // # C source code
    '.h', // # C header
    '.cpp', // # C++ source code
    '.hpp', // # C++ header
    '.py', // # Python source code
    '.java', // # Java source code
    '.js', // # JavaScript source code
    '.ts', // # TypeScript source code
    '.swift', // # Swift source code
    '.go', // # Go source code
    '.rb', // # Ruby source code
    '.php', // # PHP source code
    '.css', // # Cascading Style Sheets
    '.scss', // # Sassy CSS
    '.less'
  ],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
}

export const SiteInfo = {
  name: 'LightRAG',
  home: '/',
  github: 'https://github.com/HKUDS/LightRAG'
}

// --- Graph layout performance thresholds ------------------------------------
// Shared by the initial FA2 layout (GraphControl) and the manual worker
// layouts (LayoutsControl) so the two cannot drift.

// Above this node count, node labels are forced off regardless of the
// showNodeLabel setting (the hovered node's label is still drawn by sigma's
// hover layer). Rendering thousands of labels is a major large-graph slowdown.
export const LABEL_RENDER_LIMIT = 2000

// Above this node count, layout switches assign positions directly instead of
// animating: animateNodes interpolates every node per frame on the main thread.
export const ANIMATE_NODE_LIMIT = 5000

// Edge-count threshold that switches the graph between "small-graph experience"
// and "large-graph performance". At or below it edges render as curves and edge
// events (hover/click picking) follow the user setting; above it edges render
// straight and edge events are fully disabled (no picking buffer allocated).
// Shared by GraphControl (defaultEdgeType), GraphViewer (enableEdgeEvents
// gating) and Settings (greying the Edge Events menu item) so they cannot drift.
export const EDGE_PERF_LIMIT = 5000

// Time budget (ms) a relaxing worker layout runs before it is stopped. Scales
// with graph size, capped so huge graphs don't run unbounded.
export const workerBudgetMs = (order: number): number => Math.min(1500 + order / 10, 10000)

// --- 3D force-graph (react-force-graph + three + d3-force-3d) ----------------
// Lower alpha decay → simulation stays "alive" longer between poll ticks,
// avoiding the "animate-stop-animate-stop" stutter. cooldownTicks well above
// the poll interval (2500ms ≈ 150 ticks@60fps) keeps the engine running
// continuously during incremental builds.
// velocity_decay lower → less damping → slower, gentler movement.
export const FG3D_D3_ALPHA_DECAY = 0.005
export const FG3D_D3_VELOCITY_DECAY = 0.2
export const FG3D_COOLDOWN_TICKS = 1000
export const FG3D_NODE_REL_SIZE = 3
export const FG3D_LINK_WIDTH = 1
// Above this node count, 3D labels are turned off (SpriteText per node is
// expensive); 2D sigma stays the better choice for very large graphs.
export const FG3D_NODE_PERF_LIMIT = 5000

// --- Drop-spring animation ---------------------------------------------------
// New nodes spawn at a high altitude and "fall" into place, snapped by links
// like a spring. Tweak these for the desired visual effect.
//   INITIAL_Y  -1800 → strong drop impact; -800 → gentle settle
//   INITIAL_VY  0.3 → slow fall; 1.0 → fast drop
//   LINK_STRENGTH 0.6 → soft spring, gentle pull; 1.0 → hard snap "啪"
//   ALPHA_DECAY 0.005 → long oscillation; 0.025 → fast convergence
export const FG3D_DROP_INITIAL_Y = -1800
export const FG3D_DROP_INITIAL_VY = 0.3
export const FG3D_DROP_LINK_STRENGTH = 0.6
export const FG3D_DROP_LINK_DISTANCE = 30

// --- Incremental build polling ----------------------------------------------
// Interval between GET /graphs polls while the pipeline is busy. Backed by no
// SSE/WebSocket on the server, polling is the only way to see new entities.
export const INCREMENTAL_POLL_INTERVAL_MS = 2500
// Stop polling after this many consecutive polls with no new nodes AND
// pipeline busy === false, confirming the build has converged.
export const INCREMENTAL_NO_CHANGE_STOP_THRESHOLD = 2

// One-time system-suggested user prompts, injected once into userPromptHistory
// (for both fresh installs and upgrades). See settings store version 20 migration.
export const suggestedUserPrompts: string[] = [
  'Ignore the `References Section Format` instruction in the system prompt, and do not include a `References` section in the response.',
  'For inline citations, use the footnote marker syntax `[^1]`, where the `^` preceding the identifier indicates a footnote reference. When multiple citations are required at a single location, each ID should be enclosed in separate footnote markers (e.g., `[^1][^2][^3]`).'
]
