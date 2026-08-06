# Backend Spec Audit — 2026-08-03

Result of re-verifying [BACKEND_SPEC.md](./BACKEND_SPEC.md) against the actual code, route by route. Two outcomes: corrections applied to the spec, and **real bugs found in the current app**.

---

## 1. Spec corrections applied

| Spec section | Was (wrong/missing) | Now (matches code) |
|---|---|---|
| §4 Auth | No mention of a route guard | Added `proxy.ts` (Next 16 middleware): `/dashboard/*` and `/canvas/*` redirect to `/?error=unauthorized` when the `rocketmap-session` cookie is absent. Presence-only check — real auth still happens per-request. |
| §5.1 `duplicate` | "deep-copies blocks & segments" | **Blocks only**, `contentJson` only, max 9 rows. Segments, deep-dive data, assumptions, messages, AI analysis are **not** copied. |
| §5.1 `PATCH /canvas/:id` | Not noted | **A title change regenerates the slug** — old URLs break, intentional. No recognized field ⇒ `400 No valid fields to update`. |
| §5.2 `blocks/:type/analyze` | Implied a JSON response | It **streams** a UI message stream (`toolChoice: 'required'`), then fire-and-forget persists: `aiAnalysisJson`, `confidenceScore` (AI/100, fallback 0.4 if content > 20 chars else 0.2), `riskScore` (AI/100, fallback `min(1, risks.length × 0.15)`), **and auto-creates assumption rows** from `identifyAssumptions` (category hardcoded `product`, severity high→8 / medium→5 / low→2). |
| §5.3 segments `PATCH` | "partial of the above" | Whitelist excludes `colorHex` — it can only be set at create time. |
| §5.4 `suggest-experiment` | Shape undocumented | Full response shape documented: `{ experimentType, description, successCriteria, successThreshold?, costEstimate, durationEstimate, reasoning }`. Runs on the **fast** model. |
| §5.6 viability | Listed under the "reasoning" model | **Runs on flash** (`deepseek-v4-flash`), `temperature 0.3`. Precondition: total block+segment text ≥ 50 chars. Persists `viabilityScore` / `viabilityDataJson` / `viabilityCalculatedAt` onto the canvas row. |
| §5.6 `convert-lean-to-bmc` | Thin | Uses an inline `convertLeanToBmc` identity-tool (5 non-shared blocks, each `{ content, reasoning }`); overwrites `bmc`, **preserves `lean`**; response `updates: Array<{ blockType, bmc, lean, reasoning }>`. |
| §5.9 `user/export` | "GDPR-style full dump" | Actually only `{ user: { name, email }, canvases: [{ title, slug, createdAt, updatedAt, blocks }], exportDate }` — no segments, assumptions, experiments, deep-dive, or messages. |
| §6 model table | viability/suggest-experiment on pro | Both on **flash**. Reasoning model: canvas chat, block analyze, deep dive, convert, assumptions/analyze. |
| §6.1 structured output | "only `assumptions/analyze` regex-parses JSON" | **Three** routes regex-extract free-form JSON: `assumptions/analyze`, `suggest-experiment`, `viability`. All legacy — convert to forced tool calls in the rebuild. |
| §8.3 viability score | Uplift math missing | Added exact assembly: `score = min(100, base + validatedUplift)`; `potentialScore = min(100, base + totalUplift)`, clamped ≥ score and capped at `score + 60`. |
| §9 debt | — | Added: backend imports `BLOCK_DEFINITIONS` / `isSharedBlock` from `app/components/canvas/constants.ts` (a **frontend** file) — move to shared `lib/` in the rebuild. |

---

## 2. Live bugs found in the current app

> **All fixed on 2026-08-05.** 2.1–2.4 are resolved; 2.5 is still open. Two further
> instances of the same root cause were found afterwards and fixed at the same
> time — see §2.6. Kept here as a record of what was wrong and why it hid.

### 2.1 `duplicate` silently produces empty copies — ✅ FIXED
[app/api/canvas/[canvasId]/duplicate/route.ts:66](../app/api/canvas/%5BcanvasId%5D/duplicate/route.ts#L66)
Copied blocks are written with the field name `canvasId` instead of the `canvas` relationship. Under the current schema the writes fail, and the surrounding `try/catch` swallows the error — so duplicating a canvas yields a canvas with **no blocks**.

### 2.2 `user/export` returns empty `blocks[]` — ✅ FIXED
[app/api/user/export/route.ts:27](../app/api/user/export/route.ts#L27)
Blocks are queried with `Query.equal('canvasId', …)` — same stale field. The error is swallowed, so every exported canvas has an empty `blocks` array.

### 2.3 `convert-lean-to-bmc` doesn't persist — ✅ FIXED
[app/api/canvas/[canvasId]/convert-lean-to-bmc/route.ts:169](../app/api/canvas/%5BcanvasId%5D/convert-lean-to-bmc/route.ts#L169)
The persistence path queries by the **legacy integer** `canvas.id` (`Query.equal('canvasId', canvasIntId)`). The AI conversion streams back to the client fine, but the DB write targets a column the relationship schema no longer has — conversions are lost on reload.

### 2.4 `blocks/:type/analyze` skips the quota gate — ✅ FIXED
[app/api/canvas/[canvasId]/blocks/[blockType]/analyze/route.ts:17](../app/api/canvas/%5BcanvasId%5D/blocks/%5BblockType%5D/analyze/route.ts#L17)
`checkAiQuota` / `createQuotaExceededResponse` are imported but never called. This is the **only unmetered AI route** — a free user can bypass the daily budget by hammering block analysis (which runs on the expensive pro model).

### 2.5 `colorHex` is create-only — ⬜ STILL OPEN
[app/api/canvas/[canvasId]/segments/[segmentId]/route.ts:50](../app/api/canvas/%5BcanvasId%5D/segments/%5BsegmentId%5D/route.ts#L50)
The PATCH whitelist omits `colorHex`, so a segment's color can never be changed after creation. Likely an oversight.

### 2.6 Two more instances of the same root cause — ✅ FIXED

Found on 2026-08-05 while investigating why every dashboard card read `0/9`:

- **`app/dashboard/page.tsx`** — the block query used `Query.equal("canvasId", …)`, threw, and a bare `catch {}` swallowed it. Every card on the dashboard showed `0/9` with a blank mini-preview, for every user, for the life of the feature.
- **`app/dashboard/account/page.tsx`** — same field, so "blocks filled" on the account page always read 0.
- **`app/api/canvas/[canvasId]/route.ts` (DELETE)** — queried the dead field *outside* its own try/catch, so it would 500 the whole request. Removed entirely: blocks/segments/messages/assumptions all cascade off the `canvas` relationship, so the manual cleanup was never needed.

**A second bug hid behind the first:** these queries also used `Query.limit(9)`, on the assumption of 9 block rows per canvas. The atomic schema stores **33–49 rows** per canvas (many rows per block type), so simply fixing the field name would have made the query *succeed* while reading 9 of ~45 rows with duplicate `blockType` values. All four sites now use `limit(100)` and dedupe by block type.

**Root cause for 2.1–2.3 and 2.6:** leftovers from the pre-relationship schema migration (integer ids + `canvasId` column → string `$id` + `canvas` relationship). Any remaining `Query.equal('canvasId', …)` or `data: { canvasId: … }` in `app/api/**` is wrong; the correct form is `Query.equal('canvas', canvasRowId)` / `data: { canvas: canvasRowId }`.

---

*§2.1–2.4 and §2.6 were fixed on 2026-08-05. §2.5 (`colorHex`) remains open.*
