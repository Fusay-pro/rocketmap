# RocketMap — Backend Rebuild Specification

**Purpose:** everything you need to rebuild the RocketMap backend from zero, on any stack, without reading the existing code.

This document is the *contract*: data model, HTTP API, auth, AI orchestration, scoring algorithms, and invariants. It describes the system as currently built (Next.js App Router + Appwrite TablesDB + DeepSeek via the Vercel AI SDK), but is written stack-neutral. Appwrite-specific details are quarantined in [§10](#10-appwrite-specific-notes-current-implementation) so you can drop them if you move to Postgres/Prisma, Supabase, Hono, Fastify, etc.

**Read order for a rebuild:** §1 (domain) → §3 (data model) → §5 (API) → §6 (AI layer) → §11 (build order).

> **Status note (2026-08-05):** the approved next build is **not** a from-scratch rebuild of everything below. [docs/plans/2026-08-04-investment-case-office-hours.md](./plans/2026-08-04-investment-case-office-hours.md) — approved, survived 3 adversarial review rounds — identifies the current AI system's core flaw ("critiques fiction with fiction": AI-generated TAM, AI-generated projections, AI-generated viability scores) and pivots to a new module where **every load-bearing number must be `Quoted`, `Measured`, or `Untested`-with-a-named-test**, and AI is never the source of truth for figures. That module is spec'd in **[docs/INVESTMENT_CASE_SPEC.md](./INVESTMENT_CASE_SPEC.md)** — read that first. It's additive (new tables, new route, zero coupling to the canvas), so this document remains valid as the reference for the existing canvas/deep-dive/viability system, but the AI-invents-the-numbers pattern documented in §6–§8 is what the new module exists to replace, not something to carry forward into new work.

---

## Table of contents

1. [Domain model in one page](#1-domain-model-in-one-page)
2. [Runtime & environment](#2-runtime--environment)
3. [Data model](#3-data-model)
4. [Auth & authorization](#4-auth--authorization)
5. [HTTP API contract](#5-http-api-contract)
6. [AI layer](#6-ai-layer)
7. [Cost, quota & usage accounting](#7-cost-quota--usage-accounting)
8. [Scoring algorithms (pure functions)](#8-scoring-algorithms-pure-functions)
9. [Invariants, gotchas & known debt](#9-invariants-gotchas--known-debt)
10. [Appwrite-specific notes (current implementation)](#10-appwrite-specific-notes-current-implementation)
11. [Suggested build order](#11-suggested-build-order)

---

## 1. Domain model in one page

RocketMap is a **Business Model Canvas (BMC) copilot** that acts as an adversarial validator, not a template filler.

```
User
 └── Canvas (slug, title, viability score)
      ├── Block  × 9 block types      (the BMC grid; multiple rows per type = "atomic items")
      │    └── deepDive (JSON blob)   (Layer 2: market research, JTBD, unit economics, …)
      ├── Segment × N                 (customer segments; M:N with blocks)
      ├── Assumption × N              (risk register; M:N with blocks)
      │    └── Experiment × N         (test → evidence → result)
      └── Message × N                 (AI chat history, partitioned by chatKey)
```

Three depth layers, and this layering is the whole product:

| Layer | What it is | Where the data lives |
|---|---|---|
| **Layer 0 — Canvas** | 9-block grid overview | `blocks.contentJson` |
| **Layer 1 — Block detail** | AI analysis of one block: draft, assumptions, risks, questions | `blocks.aiAnalysisJson`, `assumptions` |
| **Layer 2 — Deep dive** | Block-specific research modules (TAM/SAM/SOM, personas, JTBD, unit economics, …) | `blocks.deepDiveJson` |

Cross-cutting: the **consistency checker** (system-level AI reading the whole canvas), the **risk engine** (assumption → experiment → evidence), and the **viability score**.

### The 9 block types (enum, stable keys — never rename)

```
key_partnerships  key_activities  key_resources
value_prop        customer_relationships
channels          customer_segments
cost_structure    revenue_streams
```

Two canvas modes exist in the UI: `bmc` and `lean`. Four blocks are **shared** across modes (same content in both): `channels`, `customer_segments`, `cost_structure`, `revenue_streams`. The Lean-only labels (problem, solution, key metrics, unfair advantage) are *presentation* over the same 9 rows — the backend stores only the 9 keys above.

---

## 2. Runtime & environment

Current: Next.js 16 App Router, route handlers under `app/api/**/route.ts`, Node runtime, TypeScript strict.

Nothing in the API depends on Next.js beyond `Request`/`Response` and async route params — it is portable to any fetch-style server.

### Environment variables

| Var | Required | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | yes | All LLM calls (OpenAI-compatible endpoint `https://api.deepseek.com/v1`) |
| `NEXT_PUBLIC_APPWRITE_ENDPOINT` | yes | Appwrite API base |
| `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | yes | Appwrite project |
| `NEXT_PUBLIC_APPWRITE_DATABASE_ID` | yes | Appwrite database |
| `APPWRITE_API_KEY` | yes | Server-side admin key |
| `BRAVE_SEARCH_API_KEY` | no | Web search grounding for AI; degrades gracefully when absent |
| `NEXT_PUBLIC_APP_URL` | yes in prod | OAuth redirect base |
| `VERCEL_URL` | auto | OAuth redirect fallback |

If you replace the DB, you need: a connection string, a session secret, and Google OAuth client id/secret (Appwrite currently brokers Google OAuth for you — see §4).

---

## 3. Data model

Field names below are the **wire names** used by the API and persisted JSON. Keeping them identical lets you swap the backend without touching the frontend.

### 3.1 `users`

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | |
| `email` | string | unique |
| `name` | string | |
| `onboardingCompleted` | bool | default `false` |
| `prefs` | JSON blob | key/value bag (see below) |
| `labels` | string[] | `pro` label grants the pro AI budget tier |

`prefs` keys actually used:

- `aiApiKey` — user's own BYO LLM key (legacy alias `anthropicApiKey`, still read for back-compat)
- `aiUsageCount`, `aiInputTokens`, `aiOutputTokens`, `aiTotalTokens`, `aiLastUsedAt` — lifetime counters (legacy `anthropic*` aliases read as fallback)

> On a rebuild: make `prefs` a real `user_settings` table or JSONB column. The legacy `anthropic*` alias reads exist only to migrate old rows — you can drop them in a clean build.

### 3.2 `canvases`

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | |
| `user` | FK → users | **restrict** delete |
| `slug` | varchar(256) | unique **per user**; URL routing key |
| `title` | varchar(256) | required |
| `description` | varchar(1000) | default `''` |
| `isPublic` | bool | required (public sharing is not implemented yet — reserved) |
| `viabilityScore` | double 0–100 | nullable |
| `viabilityDataJson` | longtext | serialized `ViabilityData` (§8.3) |
| `viabilityCalculatedAt` | datetime | |
| `createdAt`, `updatedAt` | datetime | app-managed, not DB-managed |

Children (`blocks`, `segments`, `messages`, `assumptions`) **cascade delete** with the canvas.

**Slug generation:** lowercase → spaces to `-` → strip non `[a-z0-9-]` → collapse repeats → trim. Empty ⇒ `untitled-canvas`. On collision within the same user, append `-2`, `-3`, …

### 3.3 `blocks`

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | |
| `canvas` | FK → canvases | cascade |
| `blockType` | enum | one of the 9 keys; indexed |
| `contentJson` | longtext | serialized `BlockContent`, see below |
| `aiAnalysisJson` | longtext | serialized `AIAnalysis` |
| `deepDiveJson` | longtext | serialized `MarketResearchData` (§3.7) |
| `confidenceScore` | double 0–1 | |
| `riskScore` | double 0–1 | |
| `segments` | M:N → segments | which segments this block/item applies to |
| `assumptions` | M:N → assumptions | |

**⚠️ Critical, easy to get wrong:** the schema is *atomic* — there can be **multiple rows with the same `blockType` for one canvas**. Convention: the **first** row is the block's main content; every subsequent row is an "item" (a card) belonging to that block. The read path flattens extras into `content.items[]` with `id = row.$id` and `name = content.bmc || content.lean`.

`contentJson` shape (all three keys, tolerate legacy variants):

```jsonc
{
  "bmc":  "text shown in BMC mode",
  "lean": "text shown in Lean mode",
  "items": [
    {
      "id": "stable-id",
      "name": "AWS hosting",
      "tags": ["infra"],
      "linkedSegmentIds": ["seg1"],
      "linkedItemIds": ["cost_structure:itemId"],   // "blockType:itemId"
      "createdAt": "ISO"
    }
  ]
}
```

Legacy tolerance the parser must keep: `{"text": "..."}` ⇒ use `text` for both `bmc` and `lean`; a bare non-JSON string ⇒ treat as `bmc`; anything unparseable ⇒ empty content. Never throw on bad `contentJson`.

`aiAnalysisJson` shape:

```jsonc
{ "draft": "", "assumptions": [], "risks": [], "questions": [], "generatedAt": "ISO" }
```

### 3.4 `segments`

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | |
| `canvas` | FK → canvases | cascade |
| `name` | varchar(256) | required |
| `description` | varchar(5000) | default `''` |
| `earlyAdopterFlag` | bool | default `false` |
| `priorityScore` | int 0–100 | default `50` |
| `colorHex` | varchar(7) | optional; falls back to a 10-color palette by list index |
| `demographics`, `psychographics`, `behavioral`, `geographic` | varchar(500) | |
| `estimatedSize` | varchar(100) | free text, e.g. `"10,000 startups worldwide"` |
| `blocks` | M:N → blocks | |

Fallback palette (index-stable):
`#6366f1 #f43f5e #10b981 #f59e0b #8b5cf6 #06b6d4 #ec4899 #84cc16 #f97316 #14b8a6`

### 3.5 `assumptions`

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | |
| `canvas` | FK → canvases | cascade |
| `assumptionText` | varchar(512) | required — **API name is `statement`** |
| `category` | enum | `market \| product \| ops \| legal`, indexed |
| `status` | enum | `untested \| testing \| validated \| inconclusive \| refuted`, indexed |
| `riskLevel` | enum | `high \| medium \| low`, indexed |
| `severityScore` | double 0–10 | required |
| `confidenceScore` | double 0–100 | |
| `source` | enum | `ai \| user`, indexed |
| `segmentIds` | varchar(1000) | JSON array of segment ids |
| `linkedValidationItemIds` | varchar(1000) | JSON array |
| `suggestedExperiment` | string | legacy; superseded by the `experiments` table |
| `suggestedExperimentDuration` | varchar(100) | legacy |
| `decisionSignal` | enum? | `kill \| pivot \| double_down \| insufficient_evidence` |
| `createdAt`, `updatedAt`, `lastTestedAt` | datetime | app-managed |
| `blocks` | M:N → blocks | source of the API's `blockTypes[]` |

> **Naming trap:** DB column is `assumptionText`, API/domain field is `statement`. Same trap: `blocks` (relation to block rows) ⇄ `blockTypes` (array of block type strings) — the API maps between them on every read and write. In a rebuild, consider storing `blockTypes text[]` directly and dropping the join.

`riskLevel` is **derived** from severity when AI creates assumptions: `>= 7 → high`, `>= 4 → medium`, else `low`.

### 3.6 `experiments`

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | |
| `assumption` | FK → assumptions | cascade |
| `type` | enum | `survey \| interview \| mvp \| ab_test \| research \| other` |
| `description` | longtext | required |
| `successCriteria` | varchar(500) | required |
| `successThreshold` | varchar(500) | optional |
| `status` | enum | `planned \| running \| completed`, default `planned` |
| `result` | enum? | `supports \| contradicts \| mixed \| inconclusive` |
| `evidence` | longtext | default `''` |
| `sourceUrl` | varchar(500) | |
| `costEstimate`, `durationEstimate` | varchar(50) | |
| `createdAt`, `completedAt` | datetime | |

**Business rule:** recording an experiment result auto-advances the parent assumption's `status`:
`supports → validated`, `contradicts → refuted`, `mixed | inconclusive → inconclusive`, and sets `lastTestedAt`.

### 3.7 `messages`

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | |
| `canvas` | FK → canvases | cascade |
| `user` | FK → users | cascade |
| `chatKey` | varchar(64) | required — partition key, see below |
| `role` | varchar(16) | `user \| assistant` |
| `content` | varchar(100000) | plain text, **or** JSON `{"parts":[…]}` for assistant turns with tool calls |
| `messageId` | varchar(64) | client-supplied idempotency/ordering id |
| `createdAt` | varchar(30) | ISO string (deliberately a string for cheap `orderAsc`) |

**`chatKey` grammar:** `<scope>` or `<scope>:<timestamp>`.
`scope` is `general` for canvas-level chat, or a `blockType` for block-level chat. The bare scope is the "Default" session; `scope:1739...` are additional sessions. Session listing does a `startsWith(chatKey, scope)` prefix scan.

Assistant `content` when tools were called:

```jsonc
{
  "parts": [
    { "type": "text", "text": "…" },
    { "type": "tool-result", "toolName": "createSegments",
      "toolCallId": "…", "args": {…}, "result": {…} }
  ]
}
```

### 3.8 `ai_usage_events`

| Field | Type | Notes |
|---|---|---|
| `userId` | string, indexed | not a relation |
| `canvasId` | string?, indexed | |
| `feature` | string | e.g. `canvas-chat`, `deep-dive:customer_segments`, `viability` |
| `model` | string | `deepseek-v4-flash \| deepseek-v4-pro` |
| `inputTokens`, `outputTokens`, `totalTokens` | int | |
| `cacheHitTokens`, `cacheMissTokens` | int | default 0 |
| `estimatedCostUsd` | double | computed at write time (§7) |

Writes here are **non-blocking**: a failure must never fail the AI request.

### 3.8 Deep-dive JSON (`blocks.deepDiveJson`)

One blob per block row, shape `MarketResearchData`. Every key is nullable/optional; modules fill in independently and merge non-destructively.

```ts
interface MarketResearchData {
  tamSamSom:            TamSamSomData | null;
  segmentation:         { segments: CustomerSegment[] } | null;
  personas:             { personas: Persona[] } | null;
  marketValidation:     { validations: ValidationItem[]; overallAssessment: string } | null;
  competitiveLandscape: { competitors: Competitor[] } | null;
  jtbd?:                JTBDData | null;
  valueProduct?:        ValueProductData | null;
  revenuePricing?:      RevenuePricingData | null;
  scorecards?:          SegmentScorecard[];              // keyed by segmentId, upserted
  segmentProfiles?:     Record<string, SegmentProfile>;  // segmentId → profile
  unitEconomics?:       UnitEconomicsData | null;
}
```

Key sub-shapes:

```ts
type MarketSizeEstimate = { value: number; methodology: string; sources: string[]; confidence: 'low'|'medium'|'high' };
type TamSamSomData = { industry: string; geography: string; targetCustomerType: string;
                       tam: MarketSizeEstimate|null; sam: …|null; som: …|null; reasoning: string };

type Persona = { id; name; age: number; occupation; segmentId; goals: string[];
                 frustrations: string[]; behaviors: string[]; quote };

type ValidationItem = { claim; status: 'confirmed'|'questioned'|'contradicted'; evidence; source };

type Competitor = { id; name; positioning; strengths: string[]; weaknesses: string[];
                    marketShareEstimate; threatLevel: 'low'|'medium'|'high' };

type JTBDStatement = { id; segmentId?; role: CustomerRoleType; situation; job; outcome;
                       statement?; pains?: JTBDPain[]; priority?; evidence?; confidence? };
// CustomerRoleType: user | buyer | decision_maker | influencer | beneficiary | economic_customer
// JTBDPainType:     functional | emotional | social | economic | status

type SegmentEconomics = { segmentId; segmentName; arpu; cac; grossMarginPct;   // 0-100
                          ltv; paybackMonths; churnRatePct; ltvCacRatio;
                          status: 'healthy'|'warning'|'critical'; methodology };

type SegmentScorecard = { segmentId; beachheadStatus: 'primary'|'secondary'|'later';
                          arpu: number|null; revenuePotential: number|null;
                          criteria: DecisionCriterion[];       // category: demand|market|execution, weight 0-1, score 1-5
                          overallScore; aiRecommendation: 'pursue'|'test'|'defer';
                          aiReasoning; keyRisks: string[]; requiredExperiments: string[];
                          dataConfidence: number; lastUpdated };
```

---

## 4. Auth & authorization

### Flow (current)

1. `signInWithGoogle()` server action → Appwrite `createOAuth2Token({ provider: google, success: <base>/auth/callback, failure: /?error=auth_failed })` → 302 to Google.
2. `GET /auth/callback?userId&secret` → exchange for a session → set cookie **`rocketmap-session`** (`httpOnly`, `sameSite=lax`, `secure` in prod, `expires = session.expire`) → redirect `/dashboard`.
3. Every request: read cookie → resolve the user. No cookie or invalid ⇒ `null`.
4. `signOut()` deletes the cookie and redirects `/`.
5. **Route guard** (`proxy.ts`, Next 16's middleware): requests to `/dashboard/*` and `/canvas/*` without the `rocketmap-session` cookie are redirected to `/?error=unauthorized`. This is presence-only (no validation) — real auth still happens per-request via `requireAuth()`.

`baseUrl` resolution order for the OAuth redirect: `Origin` header → `x-forwarded-host`/`host` with `x-forwarded-proto` (default `https`) → `NEXT_PUBLIC_APP_URL` → `https://$VERCEL_URL`. Throw if none resolve.

If you drop Appwrite: replace with any session library (Lucia, Auth.js, custom JWT). Keep the cookie name and the `/auth/callback` path so the frontend needs no change.

### Authorization model

Flat and strict — **every resource is owned by exactly one user through its canvas**:

```
requireAuth()                                  → 401 Unauthorized
verifyCanvasOwnership(canvasId, userId)        → 403 Forbidden
verifyAssumptionBelongsToCanvas(canvasId, aId) → 403 Forbidden
verifyExperimentBelongsToAssumption(aId, eId)  → 403 Forbidden
```

Nested routes must verify **every** level, not just the leaf — a request for `/canvas/A/assumptions/B/experiments/C` checks A owned by user, B in A, C in B. There is no sharing, no roles, no public read (despite the reserved `isPublic` column).

Error mapping used throughout: message `'Unauthorized'` ⇒ 401, `'Forbidden'` ⇒ 403, `'Not found'` ⇒ 404, anything else ⇒ 500.

---

## 5. HTTP API contract

All routes require auth unless noted. All bodies are JSON. `:canvasId` is the canvas **row id**, not the slug (the slug is resolved to an id by the page loader before any API call).

### 5.1 Canvas

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/canvas` | `{ title }` | `201 { slug, $id }` |
| `POST` | `/api/canvas/create-with-blocks` | `{ title, blocks: Record<blockType, string> }` | `{ slug, $id }` |
| `POST` | `/api/canvas/guided-create` | `{ messages }` | **streamed** UI message stream; creates the canvas via tool call |
| `PATCH` | `/api/canvas/:canvasId` | `{ title?, description?, isPublic? }` | `{ success: true, canvas }` |
| `DELETE` | `/api/canvas/:canvasId` | — | `{ success: true }` (cascades) |
| `POST` | `/api/canvas/:canvasId/duplicate` | — | `{ slug, $id }` |

- `create-with-blocks`: `blocks` is `Record<blockType, string>`; all 9 block rows are created even when empty, as `{ bmc: text, lean: text }`. Errors: `400 Title is required`, `400 Blocks are required`.
- `PATCH`: accepted fields are `title`, `description`, `isPublic`; **a title change regenerates the slug** (old URLs break — intentional). No recognized field ⇒ `400 No valid fields to update`.
- `duplicate`: copies title (`" (Copy)"` suffix), description, and **blocks only** — `contentJson` only, max 9 rows. Segments, deep-dive data, assumptions, messages, and AI analysis are **not** copied. Block-copy failure is swallowed (canvas still duplicates). ⚠️ Currently buggy — see §9 debt list.

### 5.2 Blocks

| Method | Path | Body | Response |
|---|---|---|---|
| `PUT` | `/api/canvas/:canvasId/blocks` | `{ blockType, contentJson }` | `{ success: true }` |

Upsert semantics: find the first row for `(canvas, blockType)` → update `contentJson`; if none, create. Note this only ever touches the *first* row — additional atomic item rows are created through AI tools and the segments link endpoints.

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `…/blocks/:blockType/analyze` | — | **streamed** UI message stream (Layer-1 analysis) |
| `POST` | `…/blocks/:blockType/chat` | `{ messages, chatKey }` | streamed |
| `POST` | `…/blocks/:blockType/deep-dive` | `{ module, inputs }` | `{ result, updatedDeepDive, usage }` |
| `PUT` | `…/blocks/:blockType/deep-dive` | `{ deepDiveJson }` | `{ ok: true }` — manual edit save |
| `POST` | `…/blocks/:blockType/segments` | `{ segmentId }` | `201 { success: true }` — link |
| `DELETE` | `…/blocks/:blockType/segments?segmentId=` | — | `{ success: true }` — unlink |

Deep-dive `module` must be one of the 13 in §6.4; otherwise `400 Invalid module`. If the model produces no tool call: `500 AI did not produce a result`.

**`analyze` behavior** (it does much more than return text — this is the Layer-1 engine):

- Streams a UI message stream (same envelope as chat), reasoning model, `toolChoice: 'required'`, `stepCountIs(3)`; the prompt asks for both `analyzeBlock` and `identifyAssumptions` tool calls.
- After the stream completes, **fire-and-forget persistence** (failures logged, never surfaced):
  - Writes `aiAnalysisJson` (`{...analysis, generatedAt}`) to the block's first row.
  - Writes `confidenceScore` = AI's value / 100, fallback heuristic when absent: `0.4` if content > 20 chars else `0.2`. Writes `riskScore` = AI's value / 100, fallback `min(1, risks.length * 0.15)`.
  - **Creates one assumption row per `identifyAssumptions` result**: `category` hardcoded `'product'`, `status 'untested'`, `source 'ai'`, `confidenceScore 0`, `severityScore` mapped from riskLevel `high→8 / medium→5 / low→2`, linked to the affected blocks' row ids.
- ⚠️ This route **skips the daily quota check** (the helpers are imported but never called) — a bug to fix in the rebuild; every other AI route gates on quota first.

### 5.3 Segments

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/canvas/:canvasId/segments` | — | `{ segments: Segment[] }` |
| `POST` | `/api/canvas/:canvasId/segments` | `{ name, description?, earlyAdopterFlag?, priorityScore?, demographics?, psychographics?, behavioral?, geographic?, estimatedSize?, colorHex? }` | `201 { segment }` |
| `PATCH` | `/api/canvas/:canvasId/segments/:segmentId` | partial of the above **except `colorHex`** | `{ segment }` |
| `DELETE` | `/api/canvas/:canvasId/segments/:segmentId` | — | `{ success: true }` |

`400 name is required` on create. PATCH whitelists exactly: `name, description, earlyAdopterFlag, priorityScore, demographics, psychographics, behavioral, geographic, estimatedSize` — `colorHex` can only be set at create time (probably an oversight; consider allowing it in the rebuild).

### 5.4 Assumptions (risk engine)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/canvas/:canvasId/assumptions` | — | `Assumption[]` (bare array) |
| `POST` | `/api/canvas/:canvasId/assumptions` | `{ statement, riskLevel, category?, blockTypes?, segmentIds?, source? }` | `201 Assumption` |
| `GET` | `…/assumptions/:id` | — | `Assumption` |
| `PATCH` | `…/assumptions/:id` | partial (`status`, `confidenceScore`, `decisionSignal`, …) | `Assumption` |
| `DELETE` | `…/assumptions/:id` | — | `{ success: true }` |
| `POST` | `…/assumptions/analyze` | — | **SSE stream**, see below |
| `POST` | `…/assumptions/:id/suggest-experiment` | — | see shape below |

`400 Missing required fields: statement, riskLevel`. Invalid `decisionSignal` ⇒ `400 Invalid decision signal`.

`suggest-experiment` response (fast model, free-form JSON regex-extracted from model text):

```jsonc
{ "experimentType": "survey|interview|mvp|ab_test|research|other",
  "description": "…", "successCriteria": "…", "successThreshold": "…",
  "costEstimate": "$0", "durationEstimate": "1 week", "reasoning": "…" }
```

**`assumptions/analyze` is Server-Sent Events**, `Content-Type: text/event-stream`, each frame `data: {json}\n\n`:

```jsonc
{ "type": "step",     "step": "loading" }
{ "type": "step",     "step": "analyzing" }
{ "type": "thinking", "text": "…model reasoning…" }
{ "type": "step",     "step": "saving", "count": 12 }
{ "type": "done",     "assumptions": [ { "$id", "statement", "category", "severityScore", "status", "blockTypes" } ] }
{ "type": "error",    "error": "…" }              // terminal; also used for quota
```

Each extracted assumption is persisted before `done` is sent. A single persistence failure is logged and skipped — it does not abort the stream.

### 5.5 Experiments

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `…/assumptions/:aid/experiments` | — | `Experiment[]` |
| `POST` | `…/assumptions/:aid/experiments` | `{ type, description, successCriteria, successThreshold?, costEstimate?, durationEstimate? }` | `201 Experiment` |
| `PATCH` | `…/assumptions/:aid/experiments/:id` | `{ status?, result?, evidence?, sourceUrl?, decisionSignal? }` | `Experiment` |
| `DELETE` | `…/assumptions/:aid/experiments/:id` | — | `{ success: true }` |

`400 Missing required fields` when `type`/`description`/`successCriteria` absent. The PATCH is where the auto-status-advance rule from §3.6 fires.

### 5.6 Analysis & scoring

| Method | Path | Response |
|---|---|---|
| `GET` | `/api/canvas/:canvasId/risk-heatmap` | `Record<blockType, RiskMetrics>` — all 9 keys always present |
| `POST` | `/api/canvas/:canvasId/viability` | `{ viability: ViabilityData }` |
| `POST` | `/api/canvas/:canvasId/convert-lean-to-bmc` | `{ updates, usage }` |

**Viability**: preconditions `400 All 9 blocks must exist` and `400 Canvas needs more content…` when total block+segment text < 50 chars. Runs on the **fast** model, `temperature 0.3`, free-form JSON regex-extracted (not the tool pattern). Persists `viabilityScore`, `viabilityDataJson`, `viabilityCalculatedAt` onto the canvas row. Score assembly is in §8.3.

**Convert lean→BMC**: uses an inline `convertLeanToBmc` identity-tool (not in the shared registry) whose schema is the 5 non-shared blocks, each `{ content, reasoning }`. Only blocks with lean content participate (`400 No lean content to convert` if none). For each converted block it overwrites `bmc` and **preserves the existing `lean` text**. Response `updates` is `Array<{ blockType, bmc, lean, reasoning }>`. `500 AI did not produce conversions` if the tool wasn't called. ⚠️ Its persistence path still queries by the legacy integer `canvasId` column — see §9 bugs.

### 5.7 Chat persistence

| Method | Path | Query / Body | Response |
|---|---|---|---|
| `GET` | `/api/canvas/:canvasId/messages` | `?chatKey=&cursor=` | `{ messages, lastId }` |
| `GET` | `/api/canvas/:canvasId/messages` | `?sessions=1&scope=<prefix>` | `{ sessions: ChatSession[] }` |
| `POST` | `/api/canvas/:canvasId/messages` | `{ chatKey, role, content, messageId }` | `{ ok: true }` |
| `DELETE` | `/api/canvas/:canvasId/messages` | `?chatKey=` | `{ ok: true }` |

`400 chatKey or sessions+scope is required` / `400 chatKey is required`. Messages page **by cursor**, ascending `createdAt`, 100 per page; sessions scan up to 500 rows.

`ChatSession = { sessionKey, label, createdAt, messageCount }`. Label = `"Default"` when `sessionKey === scope`, else the first user message truncated to 40 chars + `...`, else `"New chat"`.

### 5.8 Chat (AI)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/canvas/:canvasId/chat` | `{ messages, chatKey?, persistAssistant? }` | streamed UI message stream |
| `POST` | `…/blocks/:blockType/chat` | `{ messages, chatKey }` | streamed |

`persistAssistant` defaults `true`; when true the assistant turn (text + tool results with args) is saved after the stream completes, fire-and-forget. Persistence failure must not break the response.

### 5.9 User

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/complete-onboarding` | — | `{ success: true }` |
| `GET` | `/api/usage` | — | usage/quota summary (§7) |
| `GET` | `/api/user/anthropic-key` | — | `{ hasKey, maskedKey }` |
| `PUT` | `/api/user/anthropic-key` | `{ apiKey }` | `{ hasKey: true, maskedKey }` |
| `DELETE` | `/api/user/anthropic-key` | — | `{ hasKey: false, maskedKey: null }` |
| `GET` | `/api/user/export` | — | `{ user: { name, email }, canvases: [{ title, slug, createdAt, updatedAt, blocks: [{ blockType, content }] }], exportDate }` |

Key validation: starts with `sk-` or `sk-ant-` **and** length ≥ 20, else `400`. Masking: `first7 + "••••" + last4`; ≤ 8 chars ⇒ `"••••"`. **The raw key is never returned by any endpoint.**

> The path is named `anthropic-key` for historical reasons; the app is on DeepSeek. Rename it to `/api/user/ai-key` in the rebuild — it is only consumed by the settings page.

> `export` is canvases + block content only — segments, assumptions, experiments, deep-dive data, and messages are **not** exported. If you want a real GDPR-style dump, that's new scope. `complete-onboarding` upserts the `users` row (update; on 404 create with email/name) — it's the lazy row-creation point for users who signed in before the row existed.

---

## 6. AI layer

Built on the Vercel AI SDK (`ai`, `@ai-sdk/openai` pointed at DeepSeek). Two models:

| Purpose | Model | Used by |
|---|---|---|
| `fast` | `deepseek-v4-flash` | guided-create, block chat, **viability**, **suggest-experiment** |
| `reasoning` | `deepseek-v4-pro` | canvas chat, block analyze, deep dive, convert-lean-to-bmc, assumptions/analyze |

(Yes, viability runs on flash — cost choice, at `temperature 0.3`. Everything else uses default temperature.)

### 6.1 The structured-output pattern (important)

RocketMap mostly does **not** parse free-form JSON from the model. Three routes still do (regex-extract `/\{[\s\S]*\}/` from the text): `assumptions/analyze`, `suggest-experiment`, and `viability` — treat all three as legacy and convert them to forced tool calls in the rebuild. Everything else uses a **tool whose `execute` echoes its own arguments**:

```ts
export const estimateMarketSize = tool({
  description: '…',
  inputSchema: z.object({ /* the output schema */ }),
  execute: async (params) => params,     // identity — the tool IS the schema
});
```

The route then forces the call with `toolChoice: { type: 'tool', toolName }` and reads `result.steps[].toolResults[].result`. This gives schema-validated output for free. Keep this pattern — it's the backbone of the deep-dive system.

Two tools break the pattern and have real side effects:

- **`createGenerateCanvasTool(userId)`** — a factory returning a tool that *writes* the canvas, its 9 blocks (multiple atomic rows), and its segments to the DB, resolving `segmentRefs` (by exact segment name or 1-based position string) into real segment ids. Returns `{ slug, canvasId, title }`.
- **`searchWeb`** — hits the Brave Search API (cached, rate-limited; no-ops without `BRAVE_SEARCH_API_KEY`).

### 6.2 Canvas serialization (the context every prompt gets)

Every AI call receives the **whole canvas** as context, then is told to focus on one block. The loader:

1. Verifies canvas ownership.
2. Loads all block rows + all segment rows for the canvas (parallel, `limit 100` each).
3. Groups blocks by `blockType`; first row = content, rest = `items[]`.
4. Resolves each block's M:N segments into full segment objects.
5. Returns **exactly 9 `BlockData` objects, in canonical order** — missing types are synthesized as empty. Callers can rely on all 9 being present.

Segment load failure is swallowed (`.catch(() => ({ rows: [] }))`) — AI degrades rather than 500s.

### 6.3 Prompts

All prompts live in one versioned module and must include `BASE_SYSTEM_PROMPT` ("You are RocketMap AI, an adversarial business model validator…"). Design constraints (approved fonts, `var(--state-*)` colors, `.glow-*` classes) are enforced *in the prompt*, so the model never suggests off-system styling.

Prompt builders to reimplement:

| Builder | Used by |
|---|---|
| `buildSystemPrompt(agentType, blocks, assumptions?)` | chat, analyze, assumptions |
| `serializeCanvasState(blocks, mode)` | all of the above |
| `buildDeepDivePrompt(module, blocks, existingDeepDive, inputs)` | deep dive |
| `getDeepDiveToolName(module)` | deep dive |
| `getViabilityPrompt(...)` | viability |
| `ONBOARDING_SYSTEM_PROMPT` | guided-create |

`AssumptionContext` (the trimmed assumption view passed into prompts): `{ statement, status, riskLevel, confidenceScore, blockTypes, decisionSignal? }`.

### 6.4 Deep-dive modules → tools

13 valid modules. Each maps to exactly one tool, gets `toolChoice` forced, runs with `stopWhen: stepCountIs(3)`, and merges its result into one key of `deepDiveJson`.

| Module | Tool | Merges into | +`searchWeb` |
|---|---|---|---|
| `tam_sam_som` | `estimateMarketSize` | `tamSamSom` | ✅ |
| `segmentation` | `generateSegments` | `segmentation` | |
| `personas` | `generatePersonas` | `personas` | |
| `market_validation` | `validateMarketSize` | `marketValidation` | ✅ |
| `competitive_landscape` | `analyzeCompetitors` | `competitiveLandscape` | ✅ |
| `segment_scoring` | `scoreSegment` | `scorecards[]` (upsert by `segmentId`) | |
| `segment_comparison` | `compareSegments` | *(returned only, not persisted)* | |
| `segment_profile` | `suggestSegmentProfile` | `segmentProfiles[segmentId]` | |
| `jtbd` | `generateJTBD` | `jtbd` | |
| `value_product` | `mapValueProduct` | `valueProduct` | ✅ |
| `revenue_pricing` | `designRevenuePricing` | `revenuePricing` | ✅ |
| `unit_economics` | `estimateUnitEconomics` | `unitEconomics` (preserves existing `sensitivityResults`) | |
| `sensitivity_analysis` | `runSensitivityAnalysis` | `unitEconomics.sensitivityResults[]` (appends) | |

**Merge rule:** always start from the existing blob, overwrite one key, persist the whole thing. Never replace the blob wholesale.

**Scorecard `dataConfidence`** is computed server-side, not by the model: +20 each for a present `tamSamSom.tam`, non-empty `segmentation.segments`, non-empty `competitiveLandscape.competitors`, non-empty `marketValidation.validations` (max 80 from these), so a scorecard built on no research self-reports low confidence.

`inputs` is a flat `Record<string, string>` and is module-specific — e.g. `segment_scoring` reads `segmentName`, `segmentDescription`, `demographics`, `psychographics`, `behavioral`, `geographic`, `segmentId`; `sensitivity_analysis` reads `parameter` and `deltaPct`; `unit_economics` reads `monthlyBurn`.

### 6.5 Tool registry & agent config

```
Default toolset (all agents):
  analyzeBlock, identifyAssumptions, proposeBlockEdit,
  createBlockItems, createSegments, searchWeb
Agent 'general' additionally: checkConsistency
```

`getToolsForAgent(names, overrides?)` resolves names against a flat registry, with `overrides` used to swap in the DB-writing `generateCanvas` factory. Full registry: `analyzeBlock, checkConsistency, extractAssumptions, identifyAssumptions, suggestExperiment, calculateConfidence, searchWeb, proposeBlockEdit, createBlockItems, createSegments, generateCanvas, estimateMarketSize, generateSegments, generatePersonas, validateMarketSize, analyzeCompetitors, generateJTBD, mapValueProduct, designRevenuePricing, scoreSegment, compareSegments, suggestSegmentProfile, estimateUnitEconomics, runSensitivityAnalysis`.

Step limits: chat `stepCountIs(3)`, guided-create `stepCountIs(1)`, deep dive `stepCountIs(3)`.

**guided-create forcing rule:** once the conversation has ≥ 3 user messages, append *"You have enough information. You MUST call generateCanvas now."* to the system prompt. This is what stops the onboarding chat from looping forever.

### 6.6 AI-write tools that the frontend applies

`createBlockItems`, `createSegments`, and `proposeBlockEdit` return proposals; the **client** decides whether to apply them (via the normal PUT/POST endpoints). `proposeBlockEdit` is explicitly constrained to one card per edit — never a bullet list.

---

## 7. Cost, quota & usage accounting

### Pricing table (USD per 1M tokens)

| Model | cache hit | cache miss | output |
|---|---|---|---|
| `deepseek-v4-flash` | 0.0028 | 0.14 | 0.28 |
| `deepseek-v4-pro` | 0.003625 | 0.435 | 0.87 |

```
cost = (cacheHit/1e6)*hitRate + (cacheMiss/1e6)*missRate + (output/1e6)*outRate
```

Without a cache breakdown, **all input is billed as cache-miss** (conservative). Round to 6 dp. DeepSeek cache tokens arrive in `providerMetadata.deepseek` (or `.openai`) as `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`.

### Daily budget

| Tier | Daily USD | Determined by |
|---|---|---|
| `free` | 0.05 | default |
| `pro` | 0.60 | user has the `pro` label |

Enforcement: **every AI route** checks quota *before* doing anything else, summing today's `estimatedCostUsd` from `ai_usage_events` since midnight UTC. Over budget ⇒

```
429 { error: "Daily AI budget exceeded", limit, used, tier, resetsAt }
```

`resetsAt` = next midnight UTC. **If the quota query itself fails, fail open** (allow, log) — never lock users out on an infrastructure hiccup.

### Recording

After every AI call: update lifetime counters in user prefs **and** insert an `ai_usage_events` row, tagged with `feature` and optional `canvasId`. Both are best-effort.

### `GET /api/usage` response

```jsonc
{
  "tier": "free",
  "daily":   { "limit": 0.05, "used": 0.012, "remaining": 0.038, "resetsAt": "ISO" },
  "lifetime":{ "calls", "inputTokens", "outputTokens", "totalTokens",
               "estimatedCostUsd", "lastUsedAt" },
  "byDay":     { "2026-08-03": { "cost", "tokens", "calls" } },   // last 30 days
  "byFeature": { "canvas-chat": { "cost", "tokens", "calls" } }
}
```

Lifetime cost is estimated with flash cache-miss rates (0.14 in / 0.28 out) because per-call model isn't stored in prefs. A missing events table degrades to empty `byDay`/`byFeature` rather than erroring.

---

## 8. Scoring algorithms (pure functions)

Port these verbatim — they're deterministic and the UI depends on the exact numbers.

### 8.1 Block risk (0–100, per block type)

Sum over assumptions linked to that block:

| Assumption state | Points |
|---|---|
| `untested` + `high` | 30 |
| `untested` + `medium` | 15 |
| `untested` + `low` | 5 |
| `refuted` (any level) | 40 |
| `inconclusive` | 10 |
| `validated` / `testing` | 0 |

Cap at 100.

### 8.2 Block confidence & heatmap

Confidence = mean `confidenceScore` of linked assumptions, rounded; **0 when there are none** (no assumptions means unproven, not perfect).

`RiskMetrics = { riskScore, confidenceScore, untestedHighRisk, untestedMediumRisk, untestedLowRisk, topRisks }` where `topRisks` is the first 3 untested-high statements. The heatmap returns this for all 9 block types, always.

Border class mapping (UI contract): `risk ≥ 70 → glow-critical`, `risk ≥ 40 → glow-warning`, `confidence ≥ 70 → glow-healthy`, else none.

### 8.3 Viability score

```
score = round(assumptions*0.40 + market*0.30 + unmetNeed*0.30)     // each 0-100
```

`ViabilityData`:

```ts
{
  score,                 // today's evidence
  potentialScore,        // if all unlock steps validate
  breakdown: { assumptions, market, unmetNeed },
  verdict,               // 2-3 sentence honest assessment
  reasoning,             // legacy long form
  factorsUp: string[], factorsDown: string[],
  ceiling,               // one sentence on upside
  whatAbout,             // open question surfacing the core tension
  unlockSteps: [{ assumptionId, assumption, blockTypes, riskLevel, status,
                  upliftPoints,      // clamped to 1..30, rounded
                  suggestedTest }],
  validatedAssumptions: [{ blockType, assumption, status, evidence }],
  calculatedAt
}
```

Score assembly (exact, from the route):

```
baseScore      = computeWeightedScore(breakdown)          // the 0.4/0.3/0.3 blend
validatedUplift = Σ upliftPoints of steps with status 'validated'
totalUplift     = Σ upliftPoints of all steps

score          = min(100, baseScore + validatedUplift)
potentialScore = min(100, baseScore + totalUplift)        // or score when no steps
potentialScore = max(score, potentialScore)
if (potentialScore - score > 60) potentialScore = min(100, score + 60)   // cap the promise
```

Rules:
- The model proposes `unlockSteps` by `assumptionId`; **steps referencing unknown ids are dropped**, and the rest are rehydrated from the real assumption rows (never trust the model's copy of statement/risk/status).
- `upliftPoints` clamped to `[1, 30]`.
- `hasInvalidatedCriticalAssumptions` = any step with `riskLevel === 'high'` and status `refuted | inconclusive` — the UI uses this to override an optimistic score.
- Preconditions: all 9 blocks exist and have real content, else `400`.
- For `customer_segments`, the viability text is the block content **plus** every linked segment's fields joined with `|` — segments are first-class evidence.

---

## 9. Invariants, gotchas & known debt

Things that will bite you if you rebuild naively.

**Invariants**

1. Canvas reads always return exactly 9 blocks in canonical order — synthesize empties.
2. Multiple rows may share `(canvas, blockType)`; first = content, rest = items.
3. Never throw on malformed `contentJson` / `deepDiveJson` — fall back to empty.
4. Deep-dive merges are per-key, on top of the existing blob.
5. Ownership is checked at every nesting level.
6. Usage/quota writes are best-effort; quota checks fail open.
7. AI proposals are never auto-applied — the client applies them via normal endpoints.
8. `chatKey` is `<scope>` or `<scope>:<ts>`; the bare scope is the default session.

**Live bugs found while auditing (fix in rebuild, or now)**

- **`duplicate` writes copied blocks with the field name `canvasId`** instead of the `canvas` relationship — under the current schema the copies fail, and the surrounding try/catch swallows it, so duplicating a canvas silently produces an *empty* copy. ([duplicate/route.ts:66](../app/api/canvas/%5BcanvasId%5D/duplicate/route.ts#L66))
- **`user/export` queries blocks by `Query.equal('canvasId', …)`** — same stale field; the error is swallowed, so exports return canvases with empty `blocks[]`. ([export/route.ts:27](../app/api/user/export/route.ts#L27))
- **`convert-lean-to-bmc` persistence queries by the legacy integer `canvas.id`** (`Query.equal('canvasId', canvasIntId)`) — the AI conversion returns fine but the DB write path targets a column the relationship schema no longer has. ([convert-lean-to-bmc/route.ts:169](../app/api/canvas/%5BcanvasId%5D/convert-lean-to-bmc/route.ts#L169))
- **`blocks/:type/analyze` never calls the quota check** — the only AI route without the daily-budget gate.
- `segments/:id` PATCH can't update `colorHex` (create-only), likely an oversight.

**Debt worth fixing during the rebuild**

- `assumptionText` vs `statement`, and `blocks` (relation) vs `blockTypes` (strings) — pick one name each; store `blockTypes` as an array and drop the join table.
- Ownership lookup currently probes five candidate columns (`user`, `users`, `userId`, `owner`, `ownerId`) and catches schema errors to find the right one. That's migration scar tissue — use one column.
- `CanvasData` carries legacy `id: number`, `canvasId: number|string` alongside `$id`. Go string-id-only.
- `messages.createdAt` is a string, not a datetime, purely for cheap sorting.
- Three routes (`assumptions/analyze`, `suggest-experiment`, `viability`) regex-extract JSON from model text instead of using the tool pattern. Convert them to forced tool calls.
- The backend imports `BLOCK_DEFINITIONS` / `isSharedBlock` from `app/components/canvas/constants.ts` — a **frontend file**. In the rebuild, block definitions must live in a shared `lib/` module the server owns.
- `/api/user/anthropic-key` and the `anthropic*` prefs are misnamed (DeepSeek is the provider). Rename.
- `assumptions.suggestedExperiment` / `suggestedExperimentDuration` are dead columns superseded by `experiments`.
- `isPublic` exists but no public read path is implemented.
- Everything uses `generateText`/`streamText` per request; there is no job queue, so long deep-dive calls run inside the request. Consider a queue if you want retries.
- No rate limiting beyond the dollar-budget quota. No request-level abuse protection.

---

## 10. Appwrite-specific notes (current implementation)

Skip this whole section if you're moving off Appwrite.

- **Use `TablesDB` (v22+), never the deprecated `Databases` API.** `listRows` not `listDocuments`; results are `result.rows` not `.documents`; all params are objects (`{ databaseId, tableId, queries }`); `createRow` requires an explicit `rowId` (use `ID.unique()`).
- **Relationship fields cannot appear in `Query.select()`** — they're auto-loaded. Selecting them errors.
- Relationship queries use the related row's `$id`: `Query.equal('canvas', canvasId)`. Assigning is just `{ canvas: canvasId }`.
- A relationship value may come back as a string id **or** a nested object — always normalize with `typeof x === 'string' ? x : x.$id`.

**Required indexes** (queries will be slow or fail without them):

| Table | Index | Attributes |
|---|---|---|
| `messages` | `canvas_chatKey_createdAt` (key) | canvas, chatKey, createdAt — all ASC |
| `messages` | `canvas_chatKey_user` (key) | canvas, chatKey, user |
| `messages` | `chatKey_fulltext` (fulltext) | chatKey — required for `startsWith` session listing |
| `blocks` | `canvas_blockType` (key) | canvas, blockType |
| `segments` | `canvas` (key) | canvas |
| `canvases` | `user_slug` (key) | user, slug — slug collision check |
| `assumptions` | key indexes on category, status, riskLevel, source | |
| `ai_usage_events` | key indexes on userId, canvasId | |

**Manual console steps** (not creatable from code): the `experiments` table, the `ai_usage_events` table, and the `blocks.deepDiveJson` column (longtext, not required).

**Cascade/restrict:** canvas → blocks/segments/messages/assumptions cascade; assumption → experiments cascade; user → canvases **restrict** (deleting a user with canvases fails by design).

---

## 11. Suggested build order

Each phase is independently demoable.

> **Phase 0, before any of this:** the approved plan is the Investment Case module ([docs/INVESTMENT_CASE_SPEC.md](./INVESTMENT_CASE_SPEC.md)), not Phase 1 below. It only needs Foundation (auth, users, canvases table for the FK-free parts it borrows) from this doc — it does not touch blocks, deep-dives, AI tools, or scoring. Phases 1–6 below describe rebuilding the *existing* canvas system and are reference material, not the current build queue.

**Phase 1 — Foundation**
Auth (Google OAuth → session cookie `rocketmap-session`), `users`/`canvases` tables, `requireAuth` + `verifyCanvasOwnership`, canvas CRUD (`POST /api/canvas`, `PATCH`, `DELETE`), slug generation.
*Demo: sign in, create and rename a canvas.*

**Phase 2 — The canvas**
`blocks` table with atomic-row semantics, `contentJson` parser with all legacy fallbacks, `PUT /blocks`, the 9-block canonical loader. `segments` CRUD + block↔segment link/unlink.
*Demo: fill the grid, define segments, link them.*

**Phase 3 — AI plumbing**
Model selection (fast/reasoning), the identity-tool structured-output pattern, `serializeCanvasState`, `buildSystemPrompt`, usage logging + `ai_usage_events` + quota gate. Then `POST /canvas/:id/chat` and block chat, plus `messages` persistence with the `chatKey` scheme.
*Demo: chat with the copilot; it sees the whole canvas.*

**Phase 4 — Layer 1 & the risk engine**
`blocks/:type/analyze`. `assumptions` CRUD, `assumptions/analyze` SSE, `experiments` CRUD with the auto-status rule, `risk-heatmap`.
*Demo: extract assumptions, design an experiment, log evidence, watch the heatmap change.*

**Phase 5 — Layer 2 deep dives**
The `deepDiveJson` blob, the module→tool table, forced tool calls, per-key merge, `PUT` for manual edits. Start with `tam_sam_som` and `segmentation`, then add the rest — each is independent.
*Demo: TAM/SAM/SOM with sources; unit economics with alerts.*

**Phase 6 — Judgment layer**
Viability scoring, consistency checker, `convert-lean-to-bmc`, `duplicate`, `guided-create` (the canvas-writing tool factory), `/api/usage`, `/api/user/export`.
*Demo: the full 3-minute pitch — vague idea → guided canvas → analysis → contradictions → fixes → higher viability.*

**Not yet built** (open scope): streaming for the non-chat AI routes, shock-scenario simulation, canvas export/sharing, deep-dive layers for the remaining blocks.

---

*Generated from the RocketMap codebase, 2026-08-03. When the implementation and this document disagree, the code is right and this document is stale — update it.*
