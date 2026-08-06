# RocketMap — Investment Case Module Specification

**Status:** Approved. Source: [docs/plans/2026-08-04-investment-case-office-hours.md](./plans/2026-08-04-investment-case-office-hours.md) (survived 3 adversarial review rounds, 5 → 7 → 8/10). This document translates that approved plan into the same backend-contract format as [BACKEND_SPEC.md](./BACKEND_SPEC.md) — data model, HTTP API, validation, formulas — so it can be built directly from here.

**Purpose:** this is the actual next thing to build. It is **additive and decoupled** — new tables, one new route family, no dependency on the canvas/blocks/deep-dive/AI system. It can be built without rebuilding anything in BACKEND_SPEC.md.

**Read order:** §1 (why) → §2 (data model) → §3 (formulas) → §4 (API) → §5 (validation tiers) → §6 (build gates).

---

## Table of contents

1. [Why this exists](#1-why-this-exists)
2. [Domain model](#2-domain-model)
3. [Unit-econ formulas & recommendation logic](#3-unit-econ-formulas--recommendation-logic)
4. [HTTP API contract](#4-http-api-contract)
5. [Validation tiers](#5-validation-tiers)
6. [Build gates](#6-build-gates)
7. [Dad Decision Memo contents](#7-dad-decision-memo-contents)
8. [Edge cases & open questions](#8-edge-cases--open-questions)

---

## 1. Why this exists

The existing RocketMap AI system (documented in [BACKEND_SPEC.md](./BACKEND_SPEC.md)) generates TAM/SAM/SOM, personas, unit economics, and a viability score — all AI-invented numbers dressed as analysis. For someone deciding whether to put real capital into a real venture, that's fiction critiquing fiction. Status quo for the target user (a founder and their capital-providing parent) is gut feel plus asking an AI — both self-described as "just biases."

**The job:** know what to test before investing big money. A pre-investment business case where every number that decisions get made on is either sourced, measured, or explicitly flagged as an untested guess with a named experiment to resolve it.

**The rule that drives every schema and validation decision below:**

> Every load-bearing number is `Quoted` (document attached), `Measured` (experiment result logged), or `Untested` (with a required planned-test name). AI never invents a numeric value for the Case.

AI's only role in v1 (Gate 2, optional) is wording help and a "what's still missing" checklist — never writing a ledger number.

**Explicitly out of scope for v1:** BMC grid redesign, supplier/directory scraping, live tariff feeds, billing, chat-first UX, OCR auto-fill, auto-verdict without founder confirmation, a generalized SME platform. This is one venture's investment case, not a product yet.

---

## 2. Domain model

```
User
 └── InvestmentCase (title, currency, status: draft|published)
      ├── Quote × N          (supplier quotes: FOB + freight + duty + required attachment)
      └── DemandTest × 0..1  (case-local; max ONE per case in v1)
```

Not a BMC canvas type. No `slug` column. Not coupled to `blocks`, `segments`, `assumptions`, or `deepDiveJson` — the existing canvas AI economics views (`EconomicsView`, unit-econ deep-dive) are explicitly out of scope; the Case computes only from its own ledger.

### 2.1 `investment_cases`

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | route param |
| `userId` | string | owner, no relationship table needed — flat FK |
| `status` | enum | `draft \| published` |
| `publishedAt` | datetime? | null until published |
| `title` | string | venture / SKU name |
| `currency` | string | single currency per case in v1 |
| `skuDescription` | string | |
| `targetVolume` | float | planned sell units (base scenario) |
| `targetVolumeTag` | enum | `Quoted \| Measured \| Untested` |
| `targetVolumeSourceNote` | string? | mirrors `sellPriceSourceNote`; required at publish when tag = Quoted |
| `targetVolumePlannedTest` | string? | **required if tag = Untested** |
| `sellPricePerUnit` | float | |
| `sellPriceTag` | enum | `Quoted \| Measured \| Untested` |
| `sellPriceSourceNote` | string? | |
| `sellPricePlannedTest` | string? | **required if tag = Untested** |
| `capitalAvailable` | float? | **display-only in v1 — never enters a formula** |
| `killMarginPct` | float | kill if base landed margin % falls below this |
| `killDemandMetric` | string | empty string = demand is not part of the recommendation |
| `killDemandThreshold` | float | |
| `nextCheapestTest` | string? | manual; shown on memo when recommendation/verdict is `test_again` |
| `verdict` | enum | `invest \| test_again \| kill \| unset` — **founder-set, never computed** |
| `verdictNote` | string? | founder's rationale |
| `systemRecommendation` | enum | `invest \| test_again \| kill` — computed, non-binding (§3) |
| `createdAt`, `updatedAt` | datetime | |

**Sync rule:** on every case save, if `killDemandMetric` is non-empty, the API upserts the case's single demand-test row's `threshold` from `killDemandThreshold`. The case is the source of truth for the threshold, not the demand test row — this prevents the two from drifting apart.

### 2.2 `case_quotes` (one per supplier quote document)

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | |
| `case` | FK → investment_cases | cascade delete |
| `supplierName` | string | |
| `moq` | float | minimum order quantity |
| `fobPerUnit` | float | |
| `freightMode` | enum | `total \| per_unit` |
| `freightValue` | float | total or per-unit depending on mode |
| `dutyMode` | enum | `pct \| per_unit` |
| `dutyValue` | float | percent or per-unit depending on mode |
| `leadTimeDays` | int | |
| `paymentTerms` | string | |
| `attachmentFileId` | string? | **required for this quote to be used in published math** |
| `quoteDate` | datetime | |
| `isPrimary` | bool | exactly one primary quote drives the **base** scenario |

### 2.3 `case_demand_tests` (case-local; **max one row per case in v1** — enforce in the API, not just the UI)

| Field | Type | Notes |
|---|---|---|
| `$id` | string PK | |
| `case` | FK → investment_cases | cascade delete; API rejects a second row for the same case |
| `hypothesis` | string | |
| `method` | enum | `landing \| preorder \| outreach \| interview \| other` |
| `metricName` | string | must equal the case's `killDemandMetric` when that's set |
| `threshold` | float | success bar — synced from the case, see §2.1 |
| `result` | float? | null while `status` is `planned`/`running` |
| `sampleSize` | int? | |
| `status` | enum | `planned \| running \| done` |
| `evidenceFileId` | string? | optional |

**Indexes:** `userId` on `investment_cases`; `case` on both `case_quotes` and `case_demand_tests`. One storage bucket for attachments (`attachmentFileId`, `evidenceFileId`).

### 2.4 Distribution

Dad-facing output in v1 is a **PDF / print memo** for the logged-in founder — no guest auth, no magic link. Existing web app, new authenticated route, existing CI/CD, PDF via browser print or a lightweight PDF lib.

---

## 3. Unit-econ formulas & recommendation logic

All money in the case's `currency`. Computed server-side, never by an LLM.

### 3.1 Per-unit landed cost (from the primary quote)

```
freightPerUnit = freightMode == 'total' ? freightValue / moq : freightValue   // total mode allocates by moq (conservative)
dutyPerUnit    = dutyMode == 'pct' ? fobPerUnit * dutyValue / 100 : dutyValue
landedPerUnit  = fobPerUnit + freightPerUnit + dutyPerUnit
```

The memo must state that freight totals are allocated by `moq`.

### 3.2 Base scenario

```
contributionPerUnit = sellPricePerUnit - landedPerUnit
landedMarginPct     = sellPricePerUnit == 0 ? N/A : contributionPerUnit / sellPricePerUnit * 100
capitalRequired      = landedPerUnit * max(moq, targetVolume)
breakEvenUnits        = contributionPerUnit <= 0 ? Infinity : capitalRequired / contributionPerUnit
```

### 3.3 Downside / upside scenarios

| Scenario | Landed cost | Volume | Demand |
|---|---|---|---|
| **Base** | primary quote | `targetVolume` | — |
| **Downside** | **max** landed across all *complete* quotes (or primary × 1.15 if only one complete quote exists) | 50% of `targetVolume` | if `result == null`, treat demand as **failed** in the narrative; if `result` is set, use 50% of `result` |
| **Upside** | **min** landed across all complete quotes | 150% of `targetVolume` | — |

"Complete" quote = has FOB, freight, duty, and an attachment. Incomplete quotes are excluded from scenario math but are fine to leave in draft.

### 3.4 System recommendation (non-binding — the founder always sets the actual `verdict`)

```
if publish-invalid state:
    → don't show "invest"; force the test_again checklist
else if any load-bearing field is Untested without a plannedTest:
    → test_again
else if base landedMarginPct < killMarginPct:
    → kill
else if killDemandMetric is non-empty:
    if demand test is missing or status != 'done':
        → test_again
    else if result < killDemandThreshold:
        → kill
    else:
        → invest
else:
    → invest   // no demand kill-metric configured
```

The UI shows the recommendation plus the checklist that produced it. The founder explicitly sets `verdict` — the system never auto-sets it. The memo carries a fixed disclaimer: *"Not financial advice; founder judgment required."*

**Load-bearing fields for publish** (the set the recommendation logic and the publish gate both check): primary quote's FOB/freight/duty (+ attachment), `sellPricePerUnit` (+ tag/plannedTest), `targetVolume` (+ tag/plannedTest), and the demand test's `result` — but only *if* `killDemandMetric` is set and status is `done`; otherwise missing demand data pushes the recommendation to `test_again`, it does not block publish by itself (a house rule can tighten this later).

---

## 4. HTTP API contract

Same conventions as [BACKEND_SPEC.md §4](./BACKEND_SPEC.md#4-auth--authorization): `requireAuth()` → 401, ownership check → 403. Ownership here is a flat `userId` match on `investment_cases`, then case-membership checks for nested quote/demand-test routes (mirrors `verifyCanvasOwnership` / `verifyAssumptionBelongsToCanvas` in the existing codebase).

### 4.1 Cases

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/investment-cases` | — | `{ cases: InvestmentCase[] }` (list view, no nested quotes/demand test) |
| `POST` | `/api/investment-cases` | `{ title, currency, skuDescription? }` | `201 { $id }` — creates a `draft` |
| `GET` | `/api/investment-cases/:id` | — | full case: `{ case, quotes: Quote[], demandTest: DemandTest \| null, scenarios: { base, downside, upside }, systemRecommendation }` — scenarios computed on every read, never cached |
| `PATCH` | `/api/investment-cases/:id` | any subset of the ledger fields in §2.1 | updated case. Runs the `killDemandThreshold` → demand-test `threshold` sync (§2.1) when applicable |
| `DELETE` | `/api/investment-cases/:id` | — | `{ success: true }` (cascades quotes + demand test) |
| `POST` | `/api/investment-cases/:id/publish` | — | runs the **Publish tier** (§5); `400` with a field-level error list if invalid; on success sets `status: 'published'`, `publishedAt` |

`PATCH` is intentionally loose at the draft tier — see §5. Every `*Tag` field must be one of `Quoted/Measured/Untested`; setting it to `Untested` without the matching `*PlannedTest` string is allowed at draft time and rejected at publish time.

### 4.2 Quotes

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/investment-cases/:id/quotes` | — | `Quote[]` |
| `POST` | `/api/investment-cases/:id/quotes` | `{ supplierName, moq, fobPerUnit, freightMode, freightValue, dutyMode, dutyValue, leadTimeDays?, paymentTerms?, quoteDate, isPrimary? }` | `201 Quote` |
| `PATCH` | `/api/investment-cases/:id/quotes/:quoteId` | partial of the above, plus `attachmentFileId` | `Quote` |
| `DELETE` | `/api/investment-cases/:id/quotes/:quoteId` | — | `{ success: true }` |

Setting `isPrimary: true` on one quote must unset it on the case's other quotes in the same write (exactly one primary at a time).

### 4.3 Demand test

Max one per case, so this is a singleton resource, not a collection — `PUT` (upsert) rather than `POST`.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/investment-cases/:id/demand-test` | — | `DemandTest \| null` |
| `PUT` | `/api/investment-cases/:id/demand-test` | `{ hypothesis, method, metricName, sampleSize?, status, result? }` | `DemandTest` — creates if absent, else updates the single existing row. `threshold` is not settable here; it's synced from the case's `killDemandThreshold`. `400` if `metricName` doesn't match `killDemandMetric` when that's set. |
| `DELETE` | `/api/investment-cases/:id/demand-test` | — | `{ success: true }` |

### 4.4 Attachments

Reuse whatever storage/upload pattern the app already has for file uploads (Appwrite Storage bucket per BACKEND_SPEC.md's stack). One endpoint, e.g. `POST /api/investment-cases/:id/attachments` accepting multipart form data, returning `{ fileId }` to be placed into `attachmentFileId` or `evidenceFileId` on the relevant quote/demand-test PATCH/PUT.

### 4.5 Memo

| Method | Path | Response |
|---|---|---|
| `GET` | `/api/investment-cases/:id/memo` | The 9-section computed memo payload (§7) as JSON — the print/PDF view renders this client-side or via a PDF lib. No separate memo storage; always derived live from the case + quotes + demand test. |

### 4.6 AI (Gate 2, optional — build last, and only if wanted)

If built: a route that takes the current case and returns wording suggestions or a "what's missing" checklist string array. It **must not** be able to write any field in §2.1–2.3 that participates in a formula. Treat it as advisory text only, never structured output that gets auto-applied — stricter than the existing canvas AI tools, which at least route proposals through explicit user-approved apply steps.

---

## 5. Validation tiers

Two tiers, enforced server-side (client mirrors them for UX, not as the source of truth).

| Action | Rule |
|---|---|
| **Draft save** (`PATCH`) | Anything goes. Incomplete quotes OK. Tags optional. `Untested` without a `plannedTest` is OK. This tier exists so a founder can start entering real numbers before they have everything. |
| **Publish** (`POST .../publish`) | **All** of: primary quote is complete (FOB + freight + duty + `attachmentFileId`) · `sellPricePerUnit` and `targetVolume` are both tagged · if a tag is `Quoted`, that field's `*SourceNote` (`sellPriceSourceNote` / `targetVolumeSourceNote`) is non-empty · if a tag is `Measured`, the demand test has an `evidenceFileId` or a non-empty `hypothesis` linking the measured observation · every `Untested` load-bearing field has a non-empty `plannedTest` · if `killDemandMetric` is set, exactly one demand test exists with a matching `metricName` and `threshold === killDemandThreshold` (server syncs this on save, so it should always hold — validate anyway) · `verdict !== 'unset'` |

Publish failure returns a field-level list, not a single generic error — the founder needs to know exactly what's missing to move from draft to published.

---

## 6. Build gates

This ships in three gates, and **Gate 0 is homework, not code** — do not start Gate 1 until it's done.

### Gate 0 — no code
Founder picks one real SKU/venture path. Collects **two real supplier quotes**. Defines **one demand test** with a numeric threshold and kill criteria. Walks the parent through a **paper/Notion** Dad Decision Memo for 30 minutes. Records whether the decision moved, and every field the parent asked for that wasn't on the paper version — that list becomes the acceptance checklist for Gate 1.

Template to fill:
```
SKU:
Currency:
Quote A: supplier / FOB / freight / duty / MOQ / file
Quote B: ...
Sell price hypothesis + how we'll test:
Target volume hypothesis + how we'll test:
Demand test: method / metric / threshold
Kill: margin % / demand threshold
Dad asked for (missing on paper):
Decision moved? Y/N — notes:
```

### Gate 1 — the module (§2–§5 above)
Schema (§2) + full CRUD (§4) + manual ledger entry + attachments + computed scenarios (§3) + founder-selected verdict + PDF/print memo (§7). This is the buildable scope of this document.

**Gate 1 "dogfood ready"** only once every field from the Gate 0 template is either present in the UI or explicitly surfaced as an Unknown on the memo.

### Gate 2 — optional
AI wording help + a "what's still missing" checklist (§4.6). Still zero invented numbers. OCR auto-fill is deferred to v1.1, not part of this spec.

### Acceptance tests for Gate 1

- Draft save allows incomplete data.
- Publish is blocked unless every rule in §5's Publish tier passes.
- The memo printout contains all 9 sections from §7.
- Fixture case: 2 complete quotes + a demand test marked `done` with `result` below `killDemandThreshold` + a `killMarginPct` the base margin clears → `systemRecommendation = kill`; founder may still override to `test_again`.

---

## 7. Dad Decision Memo contents

One printable page, computed live from the case (§4.5), never stored separately:

1. Title, date, currency, SKU
2. Verdict (founder-set) + system recommendation + the fixed disclaimer
3. Base unit-econ table: landed cost, margin %, capital required, break-even units
4. Scenario summary: base / downside / upside
5. **Knowns** — every `Quoted`/`Measured` field with its source reference
6. **Unknowns** — every `Untested` field with its planned test
7. Demand test card (zero or one)
8. Kill criteria (`killMarginPct`, and `killDemandMetric`/`killDemandThreshold` if set)
9. `nextCheapestTest` — required on the UI whenever the verdict or the system recommendation is `test_again`

---

## 8. Edge cases & open questions

| Case | Behavior |
|---|---|
| Conflicting quotes | Base uses the primary; downside/upside use max/min landed across complete quotes |
| Partial quote | Excluded from scenario math; fine to leave in draft |
| Demand test in progress | Recommendation is `test_again` |
| `result == null` in the downside scenario | Demand is treated as failed for the scenario narrative |
| Multiple currencies | Not supported — one currency enforced per case in v1 |
| Quote older than 90 days | Warning badge on the UI, not a hard block |
| OCR of quote documents | Not in v1 |

**Open, not yet locked:**

1. Exact SKU/category for the first real dogfood deal — resolved during Gate 0, not before.
2. When (if ever) to promote this into a stripped-down BMC (the plan's Approach B/C) — explicitly deferred until **after** at least one real decision has gone through the memo. Until then, this module stays fully decoupled from the canvas system in BACKEND_SPEC.md.
3. Default currency/geography — set per-case during Gate 0, no global default needed for v1.

**Locked, not open:** dad's distribution format (PDF/print, no portal), duty/freight lookup (manual entry, no live tariff API), `case_ledger_fields` as a separate table (rejected — not needed for the fields in §2.1–2.3).

**Dependency:** manual Appwrite console work — create `investment_cases`, `case_quotes`, `case_demand_tests` + a storage bucket + the indexes in §2.3, same manual-table pattern as `experiments` and `ai_usage_events` in the existing system (BACKEND_SPEC.md §10). This module does **not** block on or reuse the existing Risk Engine `experiments` table — demand tests here are case-local, not assumption-linked.

---

*Translated from [docs/plans/2026-08-04-investment-case-office-hours.md](./plans/2026-08-04-investment-case-office-hours.md) (Approved, 2026-08-04) into backend-contract form on 2026-08-05. If the two documents disagree, the plan is the design decision of record and this document has a transcription bug — fix this file, don't silently deviate from the plan.*
