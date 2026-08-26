# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RocketMap** is a startup interactive planbook copilot - a "Playable Business Model Engine" that transforms business strategy into a living system. It enables users to validate assumptions, detect contradictions, and stress-test their startup ideas through AI-powered analysis.

### Core Philosophy

- AI analyzes structural coherence across business model components
- AI extracts hidden assumptions from user inputs
- AI simulates shock scenarios and reveals fragility points
- AI acts as an adversarial validator, not just a content generator

### MVP Scope

1. **Business Model Canvas (BMC)** - 9-block interactive board with expandable deep-dive layers
2. **Multi-Layer Architecture** - Each BMC block expands into specialized analysis layers:
   - **Layer 0 (Canvas):** The 9-block BMC grid overview
   - **Layer 1 (Block Detail):** Expanded view with AI-generated structured outputs (draft, assumptions, risks, questions)
   - **Layer 2 (Deep Dive):** Block-specific research modules (e.g., Customer Segments → Market Research)
3. **Per-block AI Copilot** - LLM assists within each block for content generation, analysis, and validation
4. **System-level AI** - Cross-block reasoning that flags contradictions, missing links, and logical gaps (Consistency Checker)

The critical differentiator is **multi-layer depth + cross-block reasoning** - not just filling boxes, but drilling into each block with specialized research tools while validating coherence across the entire business model.

## Development Commands

```bash
# Development server (runs on http://localhost:3000)
npm run dev

# Production build
npm run build

# Run production build locally
npm run start

# Linting
npm run lint
```

## Tech Stack

- **Framework:** Next.js 16.1.6 (App Router)
- **UI Library:** Radix UI Themes 3.3.0
- **Styling:** Tailwind CSS v4 + custom CSS variables
- **Fonts:** Lexend Deca (sans), Crimson Text (display/serif, weights 400/600/700 only), Geist Mono (mono)
- **TypeScript:** Strict mode enabled

## Architecture & Key Concepts

### Design System: "Calm Until Critical"

The interface maintains a neutral, professional state during normal operation. Visual emphasis (chromatic effects, glows, animations) emerges only when blocks become fragile or require attention.

**State-Based Visual Language:**

- **Calm:** Muted gray, subtle holographic borders, allows focus
- **Healthy/Validated:** Green-blue shimmer with subtle glow
- **Warning/Fragile:** Amber-gold with rainbow edge highlights
- **Critical/Collapse Risk:** Hot pink-red with chromatic aberration and pulsing glow
- **AI Analysis Active:** Cyan-purple holographic gradient with scanning effects

### Multi-Layer Block Architecture

Each BMC block supports expanding into deeper analysis layers:

**Customer Segments → Market Research Layer:**

- TAM / SAM / SOM estimation (with AI-assisted sizing)
- Market segmentation (demographic, psychographic, behavioral, geographic)
- Customer personas generation
- Competitor landscape mapping
- Market trends and growth drivers

**Other blocks will have their own deep-dive layers** (planned):

- Value Propositions → Feature-benefit mapping, competitive positioning matrix
- Revenue Streams → Pricing strategy analysis, unit economics modeling
- Channels → Channel effectiveness analysis, customer journey mapping
- Key Resources → Resource gap analysis, build-vs-buy assessment
- Cost Structure → Cost modeling, break-even analysis
- Key Activities → Process mapping, capability assessment
- Key Partnerships → Partnership evaluation framework
- Customer Relationships → Retention strategy, lifecycle mapping

### AI Architecture

**Two levels of LLM integration:**

1. **Block-level AI Copilot** - Operates within a single block or its deep-dive layer:

   - Content drafting and refinement
   - Research assistance (e.g., market sizing calculations for Customer Segments)
   - Structured output generation (assumptions, risks, questions)
   - Layer-specific analysis (e.g., TAM estimation, persona generation)

2. **System-level AI (Consistency Checker)** - Operates across the entire canvas:
   - Cross-block contradiction detection
   - Missing link identification
   - Coherence scoring
   - Suggested fixes with specific block references

AI prompts receive the **entire canvas as context** but focus on the selected block/layer while referencing others for consistency checking.

### Data Structure

Each BMC block is stored as structured JSON containing:

- Block type (e.g., "Customer Segments", "Value Propositions")
- User-entered content (per canvas mode: BMC / Lean)
- AI-generated analysis (assumptions, risks, questions)
- Deep-dive layer data (block-specific, e.g., market research results)
- Confidence level (Low/Med/High)
- State (calm/healthy/warning/critical)
- Connections to other blocks

### Component Organization

```
app/
├── layout.tsx              # Radix Theme wrapper, global fonts
├── globals.css             # CSS variables, chromatic effects, animations
├── page.tsx                # Landing page
├── dashboard/              # User dashboard with canvas list
├── canvas/[slug]/          # Canvas view (BMC grid)
│   ├── page.tsx            # Server component, data fetching
│   └── CanvasClient.tsx    # Client component, interactive canvas
├── components/
│   ├── canvas/             # BMC grid, block cells, toolbar, connection lines
│   │   ├── BMCGrid.tsx     # 9-block grid layout
│   │   ├── BlockCell.tsx   # Individual block with state variants
│   │   ├── BlockFocusPanel.tsx # Resizable sidebar (Layer 1), AI analysis + chat
│   │   ├── CanvasToolbar.tsx # Mode toggle, actions
│   │   └── constants.ts    # Block definitions and grid positions
│   ├── blocks/             # Expanded block views with deep-dive layers
│   │   ├── DeepDiveOverlay.tsx  # Full-screen overlay (Layer 2)
│   │   └── market-research/    # 5 sub-modules + tab container
│   ├── ai/                 # ChatMessage, ChatMessages, ChatInput, ChatBar, BlockChatSection
│   └── ui/                 # Control panel, AI analysis panel
├── api/
│   ├── canvas/             # Canvas CRUD, block analyze, block chat, deep-dive endpoints
│   └── complete-onboarding/ # Onboarding flow
lib/
├── ai/
│   ├── tools.ts            # AI tool definitions (analyzeBlock, 5 deep-dive tools, etc.)
│   ├── prompts.ts          # System prompts, deep-dive prompts, canvas serialization
│   ├── agents.ts           # Agent config (tool selection per block type)
│   └── canvas-state.ts     # Load blocks from Appwrite for AI context
├── types/
│   └── canvas.ts           # BlockType, BlockState, CanvasMode, BlockData, MarketResearchData, deep-dive types
├── appwrite.ts             # Appwrite client SDK
├── appwrite-server.ts      # Appwrite server SDK
└── utils.ts                # Shared utilities
```

### Styling Approach

- **CSS Variables** in `globals.css` for colors, states, and chromatic effects
- **Tailwind** for layout, spacing, responsive design
- **Radix Theme tokens** for component styling via props
- **Custom animations** for holographic effects, state transitions, and glows

Key classes:

- `.chromatic-border` - Multi-color gradient borders
- `.glow-{state}` - State-based shadow effects (calm/healthy/warning/critical/ai)
- `.holographic-bg` / `.holographic-strong` - Gradient backgrounds with shimmer
- `.glass-morphism` - Semi-transparent cards with backdrop blur
- `.state-transition` - Smooth state changes (300ms/500ms)

### Theme Configuration

Radix Theme is configured in [app/layout.tsx](app/layout.tsx:37-43) with:

- `appearance: "dark"`
- `accentColor: "iris"` (purple-blue for holographic feel)
- `grayColor: "gray"` (neutral surfaces)
- `radius: "large"` (modern curves)

## Development Guidelines

### AI Prompt Engineering

**CRITICAL:** All LLM integrations must include the System Prompt from [lib/ai/PROMPT_TEMPLATES.md](lib/ai/PROMPT_TEMPLATES.md).

When implementing AI features, prompts must:

1. Include the System Prompt (enforces design constraints globally)
2. Send the entire canvas state as context
3. Instruct the model to focus on the selected block while cross-referencing others
4. Return structured JSON output with all required fields
5. Reference design variables in suggestions (var(--state-_), var(--font-_), .glow-\* classes)
6. Never suggest fonts outside the three approved typefaces
7. Be versioned and stored in the repository

**Example LLM suggestion:**

```
❌ BAD: "Use Arial for labels and make it red"
✅ GOOD: "Apply .font-display-small (Crimson Text, weight 600) with var(--state-warning) (#f59e0b) and .glow-warning class"
```

### Consistency Checker (System-Level AI)

The killer feature. After users fill 2-3 blocks, it should:

- Compare customer segments with channels and value propositions
- Validate revenue streams match cost structures
- Flag vague or contradictory statements
- Suggest missing connections between blocks
- Cross-reference deep-dive layer data (e.g., does TAM support the revenue projections?)

Output format:

- List of contradictions with specific block references
- Severity indicators (minor/major/critical)
- Suggested fixes or validation questions

### Market Research Layer (Customer Segments Deep-Dive)

**First deep-dive layer to implement.** When the Customer Segments block is expanded:

1. **TAM/SAM/SOM Calculator** - AI-assisted market sizing with source citations
2. **Segmentation Builder** - Define segments by demographics, psychographics, behavior, geography
3. **Persona Generator** - AI creates detailed customer personas from segment data
4. **Market Size Validation** - Cross-reference with industry data and benchmarks
5. **Competitive Landscape** - Map competitors within each segment

Each sub-module has its own LLM integration for research assistance, with results feeding back into the main Customer Segments block content and influencing cross-block consistency checks.

### Visual Feedback Signals

Two simple indicators make the system feel "alive":

1. **Confidence meter per block** (Low/Med/High) - based on specificity of content and depth of research
2. **Red flags count** - aggregated from AI-detected risks + contradictions
3. **Depth indicator** - Shows how many layers have been explored per block

### Animation Performance

- Use `transform` and `opacity` for GPU acceleration
- Respect `prefers-reduced-motion` (already implemented in globals.css)
- Use `will-change` sparingly (only for active animations)
- Debounce pan/zoom interactions

### Accessibility

- Keyboard navigation for all interactive elements
- ARIA labels for canvas controls
- Screen reader announcements for state changes
- High contrast text even with chromatic effects (white on dark backgrounds)

## Current State (as of 2026-02-14)

The codebase currently has:

- ✅ Radix UI + Tailwind setup complete
- ✅ Dark theme with chromatic effects system implemented
- ✅ Typography system (Lexend Deca, Crimson Text [weights 400/600/700 only], Geist Mono)
- ✅ State-based glow and animation utilities
- ✅ Landing page with auth flow
- ✅ Appwrite integration (auth, database)
- ✅ Dashboard with canvas list and onboarding
- ✅ BMC grid layout (9 blocks) with BlockCell components
- ✅ Canvas view with BMC/Lean mode toggle
- ✅ Block definitions with grid positioning
- ✅ Type system for canvas data (BlockType, BlockState, CanvasMode, BlockData)
- ✅ Block Focus Panel (Layer 1) with resizable sidebar, AI analysis, collapsible content
- ✅ Per-block AI Copilot chat (markdown rendering via react-markdown)
- ✅ System-level Consistency Checker (cross-block reasoning)
- ✅ Market Research deep-dive (Layer 2) for Customer Segments — 5 sub-modules:
  - TAM/SAM/SOM estimation with nested circles visualization
  - Customer segmentation with editable segment cards
  - Persona generation linked to segments
  - Market validation (cross-checks TAM estimates)
  - Competitive landscape mapping
- ✅ Deep-dive AI gated behind all 9 blocks filled (≥10 chars each)
- ✅ Deep-dive data persisted via `deepDiveJson` column on blocks collection
- ✅ Consistency checker receives deep-dive summaries in canvas state
- ✅ Risk Engine (Assumption → Experiment → Evidence)
  - Risk-first kanban board (6 columns by risk level and status)
  - Manual and AI-powered assumption creation
  - Experiment design with AI suggestions
  - Evidence collection with auto-status updates
  - Canvas risk heatmap (risk-based block borders)
  - Block Focus Panel risk analysis section
  - Analysis tab risk overview

Next implementation steps:

1. Build deep-dive layers for remaining 8 blocks (Value Props, Revenue, etc.)
2. Streaming AI responses (currently uses generateText, not streamText)
3. Shock scenario simulation
4. Canvas export / sharing

## Design Documentation

### Primary Design Reference

See **[docs/DESIGN_GUIDELINES.md](docs/DESIGN_GUIDELINES.md)** for the canonical source on:

- **Typography System** (Lexend Deca / Crimson Text / Geist Mono with usage rules)
- **Color System** (State-based palette, CSS variables)
- **Component Architecture** (Block states, spacing, animations)
- **AI Agent Requirements** (How to constrain LLM suggestions)
- **Design Validation Checklist** (Pre-commit checks)

### AI Integration

See **[lib/ai/PROMPT_TEMPLATES.md](lib/ai/PROMPT_TEMPLATES.md)** for:

- **System Prompt** (Include in every LLM API call - enforces design constraints)
- **Block-Level Copilot** (Per-block analysis prompts)
- **Consistency Checker** (Cross-block reasoning prompts)
- **Market Research Deep-Dive** (TAM/SAM/SOM, personas, competitive analysis)

See **[docs/PROMPT_EVALUATION.md](docs/PROMPT_EVALUATION.md)** before editing any prompt, for:

- **Measured vs argued** (which past changes have evidence behind them — most do not)
- **Eval design rules** (judge with a different provider; prefer deterministic checks; calibrate thresholds)
- **Why not to fine-tune** (training on current output would bake in the bias just removed)
- **Open risks** (removing the 0-100 breakdown request may have made verdict prose vaguer — untested)

### Quick Validation

Use **[docs/VALIDATION_CHECKLIST.md](docs/VALIDATION_CHECKLIST.md)** for:

- Pre-commit typography/color/component checks
- Debug guide for common issues
- Monthly audit commands to catch design drift

---

### Historical Design Reference

See [docs/plans/2026-02-13-radix-chromatic-theme-design.md](docs/plans/2026-02-13-radix-chromatic-theme-design.md) for comprehensive design specifications including:

- Complete color system and state definitions
- Component architecture and layout details
- Animation keyframes and timing functions
- Technical implementation approach
- Accessibility requirements

## Gotchas

- **⚠️ CRITICAL - Appwrite TablesDB API**: ONLY use `TablesDB` API (v22+), NOT the deprecated `Databases` API. See [docs/APPWRITE_TABLESDB_MIGRATION.md](docs/APPWRITE_TABLESDB_MIGRATION.md) for complete guide. Key points:
  - Use `serverTablesDB.listRows()` NOT `serverDatabases.listDocuments()`
  - Response is `result.rows` NOT `result.documents`
  - Parameters are objects: `{ databaseId, tableId, queries }`
  - `createRow()` **requires** an explicit `rowId` — pass `ID.unique()`. (An earlier note here said it was auto-generated; that is wrong for node-appwrite v22, whose types declare `rowId: string` as required. All 22 `createRow` call sites pass it — 20 via `ID.unique()`, 2 via `user.$id`.)
  - Relationship fields CANNOT be in `Query.select()` (auto-loaded)
- **⚠️ CRITICAL - Appwrite Relationships & Queries**: When using relationships, queries use the related row's `$id`:
  - `Query.equal('canvas', canvasId)` queries against the canvas row's `$id` value
  - Pass the relationship value directly (e.g., `canvas: canvasDocId`) when creating rows
  - See [docs/APPWRITE_INDEXES.md](docs/APPWRITE_INDEXES.md) for required database indexes
- **Crimson Text font**: Only weights 400, 600, 700 — weight 500 does NOT exist (build will fail)
- **Shared blocks**: channels, customer_segments, cost_structure, revenue_streams share content across BMC/Lean modes — use `isSharedBlock()` from constants.ts
- **useRef initial value**: Must pass explicit `undefined` — `useRef<T>(undefined)` not `useRef<T>()`
- **Appwrite `deepDiveJson` column**: Must be added manually in Appwrite console (longtext, not required)
- **AI tool pattern**: `tool({ inputSchema: z.object({...}), execute: async (params) => params })` — tool acts as structured output extractor, result via `step.toolResults[].result` with `unknown` cast
- **Deep-dive AI gating**: All 9 blocks must have ≥10 chars content before deep-dive AI buttons are enabled
- **Experiments table**: Must be created manually in Appwrite console (see docs/plans/2026-02-16-risk-engine-implementation.md Task 1)

## Demo Flow (3-minute pitch)

1. Start with a vague startup idea
2. Fill 2-3 blocks quickly with basic content
3. Click "AI Analyze" on one block → show assumptions + risks + tests
4. Expand Customer Segments → deep-dive into Market Research → AI estimates TAM/SAM/SOM
5. Click "Run Consistency Check" → flags contradictions (e.g., TAM doesn't support revenue projections)
6. Fix blocks based on feedback → rerun → fewer red flags, higher confidence
7. End message: "This is a judgment amplifier, not a template filler"

The goal is to show **depth (multi-layer drill-down) + breadth (cross-block reasoning)** within minutes.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
