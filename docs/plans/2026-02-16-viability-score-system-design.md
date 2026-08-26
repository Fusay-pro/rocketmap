# Viability Score System Design

> ## ⚠️ SUPERSEDED — do not implement from this document
>
> The 0-100 composite score this document specifies **no longer exists**. Building from
> here would rebuild a system that was deliberately removed.
>
> | This doc describes | Actual current behaviour |
> |---|---|
> | Multi-factor 0-100 score, 40/30/30 weighting | **Deleted** (`9a53b61`). No composite score is computed anywhere |
> | Score badge with `getScoreColor` thresholds | **Replaced** by Q/PTP question/problem counts (`74fd136`) |
> | `viabilityScore` column written on every calc | **No longer written** (`21a5a04`). Column remains in the Appwrite schema, stale and unread |
> | Model returns `breakdown: {assumptions, market, unmetNeed}` | Prompt no longer requests it; `upliftPoints` also removed |
>
> Current source of truth: `lib/utils/evidence-counts.ts` (`deriveQptpFromViability`) and
> `lib/utils/viability.ts`. Before changing any prompt, read
> [docs/PROMPT_EVALUATION.md](../PROMPT_EVALUATION.md).
>
> **Kept for history** — it records why the scoring system was built and what it was meant
> to do, which is context the replacement does not carry.

**Date:** 2026-02-16
**Status:** Superseded 2026-08-26 (was: Approved)
**Feature:** Multi-factor viability scoring with Claude Opus 4.6

---

## Overview

Add a VIABILITY score system to the canvas that analyzes business model viability using Claude Opus 4.6. The score is displayed in the tabs area (right side) and evaluates three factors: tested assumptions, market validation, and unmet need validation.

**Key Requirements:**
- Multi-factor score (0-100%) graded by Opus 4.6
- Prerequisite: All 9 blocks must be filled (≥10 chars each)
- Display with Claude mascot, color coding, hover tooltip, "Explain Why" button
- Saved to canvases table for persistence
- Auto-recalculation on content changes (debounced)

---

## 1. Architecture

### Three Main Components

**1. API Endpoint**: `/api/canvas/[canvasId]/viability` (POST)
- Loads all 9 blocks with AI analysis and assumptions
- Calls Opus 4.6 with structured prompt
- Returns: `{ score, breakdown, reasoning, validatedAssumptions, timestamp }`
- Saves to canvases table

**2. UI Component**: `ViabilityScore` component
- Location: Right side of tabs area (next to Canvas/Analysis/Notes/Debug)
- Shows: Percentage badge + Claude mascot + refresh button
- Hover: Detailed tooltip with factor breakdown
- "Explain Why" button opens chat copilot

**3. Storage**: Canvases table columns
- `viabilityScore` (float, nullable)
- `viabilityDataJson` (longtext, nullable) - JSON-serialized ViabilityData
- `viabilityCalculatedAt` (datetime, nullable)

### Data Flow

```
User clicks "Calculate Viability"
  ↓
API loads all 9 blocks + AI analysis + deep-dive data
  ↓
Opus 4.6 analyzes:
  - Tested assumptions (validated/invalidated/untested)
  - Market validation (TAM/SAM/SOM, segments, competitors)
  - Unmet need (value prop, problem-solution fit)
  ↓
Returns score + breakdown + reasoning
  ↓
Save to canvases table
  ↓
UI updates with color-coded badge
  ↓
User edits block → "Outdated" indicator → Auto-recalc after 5s debounce
```

---

## 2. Data Model

### TypeScript Types

**Add to `lib/types/canvas.ts`:**

```typescript
export interface ViabilityBreakdown {
  assumptions: number;      // 0-100
  market: number;           // 0-100
  unmetNeed: number;        // 0-100
}

export interface ValidatedAssumption {
  blockType: BlockType;
  assumption: string;
  status: 'validated' | 'invalidated' | 'untested';
  evidence: string;
}

export interface ViabilityData {
  score: number;            // 0-100 overall
  breakdown: ViabilityBreakdown;
  reasoning: string;        // Opus explanation
  validatedAssumptions: ValidatedAssumption[];
  calculatedAt: string;     // ISO timestamp
}
```

**Update CanvasData:**

```typescript
export interface CanvasData {
  // ... existing fields
  viabilityScore?: number | null;
  viabilityData?: ViabilityData | null;
  viabilityCalculatedAt?: string | null;
}
```

### Database Schema

**Appwrite canvases table (add columns manually in console):**

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `viabilityScore` | Float | Yes | Overall score 0-100 |
| `viabilityDataJson` | String (longtext) | Yes | JSON-serialized ViabilityData |
| `viabilityCalculatedAt` | Datetime | Yes | Last calculation timestamp |

---

## 3. UI Components

### ViabilityScore Component

**File**: `app/components/canvas/ViabilityScore.tsx`

**Visual States:**

1. **Hidden** (prerequisite not met):
   - Don't render if <9 blocks filled

2. **Not Calculated** (prerequisite met):
   ```
   ▐▛███▜▌ [Calculate Viability]
   ▝▜█████▛▘
     ▘▘ ▝▝
   ```

3. **Calculating**:
   ```
   ▐▛███▜▌ ⟳ Analyzing...
   ▝▜█████▛▘
     ▘▘ ▝▝
   ```

4. **Calculated**:
   ```
   ▐▛███▜▌ [73%] 🔄 [?]
   ▝▜█████▛▘
     ▘▘ ▝▝
   ```
   - Badge color: Red (<50%), Amber (50-75%), Green (>75%)
   - 🔄 = Refresh button
   - ? = "Explain Why" button

5. **Outdated**:
   ```
   ▐▛███▜▌ [73%] [Outdated] 🔄 [?]
   ▝▜█████▛▘
     ▘▘ ▝▝
   ```
   - Pulsing refresh button
   - Auto-recalculates after 5s debounce

### Color Coding

```typescript
const getScoreColor = (score: number) => {
  if (score < 50) return {
    bg: 'bg-[#f43f5e]',        // Red
    text: 'text-white',
    glow: 'glow-critical'
  };
  if (score < 75) return {
    bg: 'bg-[#f59e0b]',        // Amber
    text: 'text-white',
    glow: 'glow-warning'
  };
  return {
    bg: 'bg-[#10b981]',        // Green
    text: 'text-white',
    glow: 'glow-healthy'
  };
};
```

### Hover Tooltip (Radix Popover)

```
┌─────────────────────────────────────────┐
│ VIABILITY SCORE: 73%                    │
│                                         │
│ Breakdown:                              │
│ • Assumptions: 80% (8/10 validated)    │
│ • Market: 70%                           │
│ • Unmet Need: 69%                       │
│                                         │
│ Validated Assumptions:                  │
│ ✓ Customer Segments: Early adopters... │
│ ✓ Value Prop: Pain relief validated... │
│ ✗ Revenue: Pricing model untested      │
│                                         │
│ Reasoning:                              │
│ [Opus 4.6 detailed explanation]        │
│                                         │
│ Last calculated: 2 minutes ago          │
│                                         │
│ [Explain Why →]                         │
└─────────────────────────────────────────┘
```

### Integration with CanvasTabs

**Modify `app/components/canvas/CanvasTabs.tsx`:**

```tsx
<div className="flex items-center justify-between">
  {/* Left: tabs */}
  <div className="flex gap-1">
    {/* existing tabs */}
  </div>

  {/* Right: viability score */}
  <ViabilityScore
    canvasId={canvasId}
    allBlocksFilled={allBlocksFilled}
    onExplainClick={handleExplainViability}
  />
</div>
```

---

## 4. AI Integration (Opus 4.6)

### API Endpoint

**File**: `app/api/canvas/[canvasId]/viability/route.ts`

**POST Request Flow:**
1. Authenticate user via `requireAuth()`
2. Verify all 9 blocks filled (≥10 chars each)
3. Load all blocks with AI analysis and deep-dive data
4. Construct Opus prompt with full canvas context
5. Call Opus 4.6 via Vercel AI SDK
6. Parse structured response
7. Save to canvases table
8. Return viability data

### Opus 4.6 Prompt

**File**: `lib/ai/prompts.ts` - Add `getViabilityPrompt()`

```typescript
export function getViabilityPrompt(blocks: BlockData[]): string {
  return `You are analyzing a startup's Business Model Canvas for viability.

CANVAS CONTEXT:
${blocks.map(b => `
Block: ${b.blockType}
Content: ${b.content.bmc || b.content.lean}
AI Analysis: ${b.aiAnalysis ? JSON.stringify(b.aiAnalysis) : 'None'}
Confidence: ${b.confidenceScore}, Risk: ${b.riskScore}
`).join('\n')}

YOUR TASK:
Grade viability (0-100%) across THREE factors:

1. TESTED ASSUMPTIONS (0-100%):
   - Review all assumptions from the 9 blocks
   - Identify which are validated vs untested vs invalidated
   - Score = (validated / total) * quality_weight
   - Critical assumptions (customer need, pricing) weighted higher
   - Look for evidence of testing (customer interviews, MVP results, etc.)

2. MARKET VALIDATION (0-100%):
   - TAM/SAM/SOM estimates quality (if available)
   - Customer segment definition clarity and specificity
   - Competitive landscape understanding
   - Evidence of market research and data sources
   - Market size supports revenue projections

3. UNMET NEED (0-100%):
   - Value proposition strength and clarity
   - Problem-solution fit articulation
   - Customer pain points depth
   - Differentiation from competitors
   - Willingness to pay indicators

SCORING RULES:
- Be critical and evidence-based
- Untested assumptions reduce score significantly
- Vague statements reduce score
- Contradictions between blocks reduce score
- Evidence of validation increases score

RETURN JSON (strictly follow this structure):
{
  "score": 73,  // overall weighted average
  "breakdown": {
    "assumptions": 80,
    "market": 70,
    "unmetNeed": 69
  },
  "reasoning": "Detailed explanation of the score...",
  "validatedAssumptions": [
    {
      "blockType": "customer_segments",
      "assumption": "Early adopters are willing to pay",
      "status": "validated",
      "evidence": "Customer interviews confirm..."
    }
  ]
}

WEIGHTING: assumptions (40%), market (30%), unmetNeed (30%)
`;
}
```

### Model Configuration

```typescript
import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const result = await generateObject({
  model: anthropic('claude-opus-4-6'),  // Opus 4.6 specifically
  temperature: 0.3,                      // Consistent scoring
  maxTokens: 4000,                       // Detailed reasoning
  prompt: getViabilityPrompt(blocks),
  schema: z.object({
    score: z.number().min(0).max(100),
    breakdown: z.object({
      assumptions: z.number().min(0).max(100),
      market: z.number().min(0).max(100),
      unmetNeed: z.number().min(0).max(100),
    }),
    reasoning: z.string(),
    validatedAssumptions: z.array(z.object({
      blockType: z.string(),
      assumption: z.string(),
      status: z.enum(['validated', 'invalidated', 'untested']),
      evidence: z.string(),
    })),
  }),
});
```

### Scoring Algorithm

**Overall score calculation:**
```typescript
score = (assumptions * 0.4) + (market * 0.3) + (unmetNeed * 0.3)
```

**Rounding:**
```typescript
Math.round(score) // Integer percentage
```

---

## 5. Component Interaction

### Block Changes → Outdated Indicator

```typescript
// In CanvasClient.tsx
const [viabilityOutdated, setViabilityOutdated] = useState(false);

useEffect(() => {
  // When any block changes after viability is calculated
  if (canvasData.viabilityScore !== null) {
    setViabilityOutdated(true);

    // Debounced auto-recalculation (5s)
    const timer = setTimeout(async () => {
      await recalculateViability();
      setViabilityOutdated(false);
    }, 5000);

    return () => clearTimeout(timer);
  }
}, [blocks]);
```

### "Explain Why" → Chat Copilot

```typescript
const handleExplainViability = () => {
  // Open chat bar
  setChatDocked(true);
  setChatTargetBlock(null); // System-level chat

  // Send pre-filled message with viability context
  const message = `Explain my canvas viability score of ${viabilityScore}% and what I should improve to increase it.

Current breakdown:
- Assumptions: ${breakdown.assumptions}%
- Market: ${breakdown.market}%
- Unmet Need: ${breakdown.unmetNeed}%

${validatedAssumptions.length} assumptions analyzed.`;

  // Chat receives this context and explains
};
```

---

## 6. Error Handling

### API Errors

| Error | Handling |
|-------|----------|
| Opus timeout (>30s) | Show toast: "Calculation failed, try again" |
| Rate limit | Retry with exponential backoff (3 attempts) |
| 401 Unauthorized | Redirect to login |
| 403 Forbidden | Show error: "Cannot calculate for this canvas" |
| 500 Server error | Log to console, show generic error toast |

### Edge Cases

| Case | Handling |
|------|----------|
| <9 blocks filled | Hide component entirely |
| Calculation in progress | Disable button, show spinner |
| Stale calculation | Show "Last calculated X minutes ago" in tooltip |
| No AI analysis | Still calculate (Opus can work with raw content) |
| Network offline | Show offline indicator, queue recalculation |

### Loading States

```typescript
type ViabilityStatus =
  | 'not_calculated'
  | 'calculating'
  | 'calculated'
  | 'outdated'
  | 'error';
```

---

## 7. Implementation Checklist

### Files to Create

- [ ] `app/api/canvas/[canvasId]/viability/route.ts` - API endpoint
- [ ] `app/components/canvas/ViabilityScore.tsx` - UI component
- [ ] `lib/ai/prompts.ts` - Add `getViabilityPrompt()` function

### Files to Modify

- [ ] `app/components/canvas/CanvasTabs.tsx` - Add `<ViabilityScore />` on right side
- [ ] `app/canvas/[slug]/CanvasClient.tsx` - Add viability state management
- [ ] `lib/types/canvas.ts` - Add viability types
- [ ] `app/canvas/[slug]/page.tsx` - Load viability data on server

### Database Changes (Manual)

- [ ] Add `viabilityScore` column (float, nullable) to canvases table
- [ ] Add `viabilityDataJson` column (longtext, nullable) to canvases table
- [ ] Add `viabilityCalculatedAt` column (datetime, nullable) to canvases table

### Testing

- [ ] Unit test: Viability calculation logic
- [ ] Unit test: Score color coding
- [ ] Integration test: API endpoint with mock Opus
- [ ] Integration test: Debounced recalculation
- [ ] E2E test: Full flow from button click to score display
- [ ] E2E test: "Explain Why" opens chat with context

---

## 8. Visual Design

### Claude Mascot ASCII Art

```
 ▐▛███▜▌
▝▜█████▛▘
  ▘▘ ▝▝
```

Display this mascot:
- Next to "Calculate Viability" button
- Next to score percentage
- In tooltip header
- Anywhere Opus 4.6 is used

### Typography & Styling

- Badge: `font-mono text-sm font-bold`
- Mascot: `font-mono text-xs leading-tight opacity-80`
- Score: Large, bold, with glow effect matching state
- Tooltip: `font-sans text-xs` with proper spacing

### Responsive Design

- Desktop: Full display with all buttons
- Tablet: Condensed (hide "Explain Why" button, keep hover)
- Mobile: Show score only, tap for modal with full details

---

## 9. Success Criteria

**Feature is complete when:**

1. ✅ All 9 blocks filled → "Calculate Viability" button appears
2. ✅ Button click → Opus 4.6 analyzes → Score displays within 10s
3. ✅ Score shows 0-100% with correct color (red/amber/green)
4. ✅ Claude mascot displays next to score
5. ✅ Hover shows detailed breakdown tooltip
6. ✅ "Explain Why" opens chat with pre-filled message
7. ✅ Score saves to database and persists across sessions
8. ✅ Block changes → "Outdated" indicator → Auto-recalc after 5s
9. ✅ Manual refresh works immediately
10. ✅ Error states handled gracefully

---

## 10. Future Enhancements (Out of Scope)

- Historical score tracking (show trend over time)
- Comparison with industry benchmarks
- Detailed assumption testing recommendations
- Export viability report as PDF
- Viability score in canvas preview cards (dashboard)
- Notification when score drops below threshold

---

## Notes

- Use Opus 4.6 specifically for highest quality analysis
- Debounce period (5s) balances UX and API costs
- Weighted scoring emphasizes tested assumptions (40% weight)
- Tooltip can be expanded with more details in future iterations
- "Explain Why" leverages existing chat copilot infrastructure

---

**Design Approved:** 2026-02-16
**Ready for Implementation:** Yes
