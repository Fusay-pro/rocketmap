"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Heading, Text, TextField, TextArea, Select, Badge, Separator } from "@radix-ui/themes";
import type {
  CaseDemandTest,
  CaseMemo,
  CaseQuote,
  CaseScenarios,
  EvidenceTag,
  InvestmentCase,
  ScenarioResult,
} from "@/lib/types/investment-case";

interface CaseDetailClientProps {
  initialCase: InvestmentCase;
  initialQuotes: CaseQuote[];
  initialDemandTest: CaseDemandTest | null;
  initialScenarios: CaseScenarios;
}

const RECOMMENDATION_COLOR: Record<string, "green" | "amber" | "red"> = {
  invest: "green",
  test_again: "amber",
  kill: "red",
};

function fmtMoney(value: number | null, currency: string): string {
  if (value === null) return "—";
  return `${currency} ${value.toFixed(2)}`;
}

function fmtPct(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

function fmtUnits(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "∞";
}

/**
 * Upload / view / remove a single attachment (spec §4.4).
 *
 * The upload names its target so the server uploads and links in one request.
 * It used to POST the bytes, receive a bare `fileId`, and have the parent PATCH
 * it onto the row — which both allowed a client to claim a file id it didn't
 * own and left the bytes stranded whenever the follow-up PATCH failed.
 *
 * Removal calls DELETE, which clears the reference *and* the blob, so the
 * parent just refetches.
 */
function AttachmentControl({
  caseId,
  fileId,
  targetKind,
  targetId,
  onChanged,
  disabled,
  disabledHint,
}: {
  caseId: string;
  fileId: string | null;
  targetKind: "quote" | "demand-test";
  targetId?: string;
  onChanged: () => Promise<void>;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("targetKind", targetKind);
      if (targetId) body.append("targetId", targetId);
      const res = await fetch(`/api/investment-cases/${caseId}/attachments`, {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      // Clear the input so re-picking the same file fires onChange again.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!fileId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/investment-cases/${caseId}/attachments/${fileId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Remove failed");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <Text size="1" style={{ color: "var(--foreground-muted)" }}>
        {disabledHint ?? "Attachment unavailable"}
      </Text>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
      {fileId ? (
        <>
          <Badge color="green" size="1">attached</Badge>
          <Button
            variant="ghost"
            size="1"
            asChild
          >
            <a
              href={`/api/investment-cases/${caseId}/attachments/${fileId}`}
              target="_blank"
              rel="noreferrer"
            >
              View
            </a>
          </Button>
          <Button variant="ghost" size="1" color="red" onClick={handleRemove} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </Button>
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.docx"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            variant="soft"
            size="1"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Uploading…" : "Attach document"}
          </Button>
        </>
      )}
      {error && <Text size="1" color="red">{error}</Text>}
    </div>
  );
}

function ScenarioCard({ label, result, currency }: { label: string; result: ScenarioResult | null; currency: string }) {
  return (
    <div className="profile-card" style={{ flex: 1, minWidth: "12rem" }}>
      <Text size="2" weight="medium" style={{ display: "block", marginBottom: "0.5rem" }}>{label}</Text>
      {!result ? (
        <Text size="2" style={{ color: "var(--foreground-muted)" }}>Add a primary quote to compute this.</Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <Text size="2">Landed cost: {fmtMoney(result.landedPerUnit, currency)}/unit</Text>
          <Text size="2">Contribution: {fmtMoney(result.contributionPerUnit, currency)}/unit</Text>
          <Text size="2">Margin: {fmtPct(result.landedMarginPct)}</Text>
          <Text size="2">Capital required: {fmtMoney(result.capitalRequired, currency)}</Text>
          <Text size="2">Break-even: {fmtUnits(result.breakEvenUnits)} units</Text>
        </div>
      )}
    </div>
  );
}

export function CaseDetailClient({ initialCase, initialQuotes, initialDemandTest, initialScenarios }: CaseDetailClientProps) {
  const router = useRouter();
  const [c, setC] = useState(initialCase);
  const [quotes, setQuotes] = useState(initialQuotes);
  const [demandTest, setDemandTest] = useState(initialDemandTest);
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [systemRecommendation, setSystemRecommendation] = useState(initialCase.systemRecommendation ?? "test_again");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishErrors, setPublishErrors] = useState<Array<{ field: string; message: string }> | null>(null);
  const [memo, setMemo] = useState<CaseMemo | null>(null);

  const [newQuote, setNewQuote] = useState({
    supplierName: "",
    moq: "",
    fobPerUnit: "",
    freightMode: "total" as "total" | "per_unit",
    freightValue: "",
    dutyMode: "pct" as "pct" | "per_unit",
    dutyValue: "",
    isPrimary: quotes.length === 0,
  });

  async function refetch() {
    const res = await fetch(`/api/investment-cases/${c.$id}`);
    if (!res.ok) return;
    const data = await res.json();
    setC(data.case);
    setQuotes(data.quotes);
    setDemandTest(data.demandTest);
    setScenarios(data.scenarios);
    setSystemRecommendation(data.systemRecommendation);
  }

  async function handleSaveLedger() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/investment-cases/${c.$id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: c.title,
          currency: c.currency,
          skuDescription: c.skuDescription,
          targetVolume: c.targetVolume,
          targetVolumeTag: c.targetVolumeTag,
          targetVolumeSourceNote: c.targetVolumeSourceNote,
          targetVolumePlannedTest: c.targetVolumePlannedTest,
          sellPricePerUnit: c.sellPricePerUnit,
          sellPriceTag: c.sellPriceTag,
          sellPriceSourceNote: c.sellPriceSourceNote,
          sellPricePlannedTest: c.sellPricePlannedTest,
          capitalAvailable: c.capitalAvailable,
          killMarginPct: c.killMarginPct,
          killDemandMetric: c.killDemandMetric,
          killDemandThreshold: c.killDemandThreshold,
          nextCheapestTest: c.nextCheapestTest,
          verdict: c.verdict,
          verdictNote: c.verdictNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setC(data.case);
      setScenarios(data.scenarios);
      setSystemRecommendation(data.systemRecommendation);
      setDemandTest(data.demandTest);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddQuote() {
    const res = await fetch(`/api/investment-cases/${c.$id}/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierName: newQuote.supplierName,
        moq: Number(newQuote.moq) || 0,
        fobPerUnit: Number(newQuote.fobPerUnit) || 0,
        freightMode: newQuote.freightMode,
        freightValue: Number(newQuote.freightValue) || 0,
        dutyMode: newQuote.dutyMode,
        dutyValue: Number(newQuote.dutyValue) || 0,
        // The first quote is always primary — publish requires one and there is
        // nothing for it to compete with.
        isPrimary: newQuote.isPrimary || quotes.length === 0,
        quoteDate: new Date().toISOString(),
      }),
    });
    if (res.ok) {
      // isPrimary resets to "only if this would be the first quote". Hardcoding
      // false here used to strand the form: the initial value was computed once
      // at mount, so after the first add there was no way to mark any quote
      // primary — and publish requires one.
      setNewQuote({ supplierName: "", moq: "", fobPerUnit: "", freightMode: "total", freightValue: "", dutyMode: "pct", dutyValue: "", isPrimary: false });
      await refetch();
    }
  }

  async function handlePatchQuote(quoteId: string, updates: Record<string, unknown>) {
    const res = await fetch(`/api/investment-cases/${c.$id}/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) await refetch();
  }

  async function handleDeleteQuote(quoteId: string) {
    const res = await fetch(`/api/investment-cases/${c.$id}/quotes/${quoteId}`, { method: "DELETE" });
    if (res.ok) await refetch();
  }

  async function handlePublish() {
    setPublishErrors(null);
    const res = await fetch(`/api/investment-cases/${c.$id}/publish`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setPublishErrors(data.errors || [{ field: "general", message: data.error }]);
      return;
    }
    setC(data.case);
    setScenarios(data.scenarios);
    setSystemRecommendation(data.systemRecommendation);
  }

  async function handleLoadMemo() {
    const res = await fetch(`/api/investment-cases/${c.$id}/memo`);
    if (res.ok) setMemo(await res.json());
  }

  return (
    <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <Button variant="ghost" onClick={() => router.push("/investment-cases")} style={{ marginBottom: "1rem" }}>
        ← All cases
      </Button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <Heading size="7" style={{ fontFamily: "var(--font-display)", fontWeight: 400 }}>{c.title}</Heading>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <Badge color={c.status === "published" ? "green" : "gray"}>{c.status}</Badge>
            <Badge color={RECOMMENDATION_COLOR[systemRecommendation] ?? "gray"}>
              system: {systemRecommendation.replace("_", " ")}
            </Badge>
          </div>
        </div>
        <Button onClick={handlePublish} disabled={c.status === "published"}>
          {c.status === "published" ? "Published" : "Publish"}
        </Button>
      </div>

      {publishErrors && (
        <div className="profile-card" style={{ marginBottom: "1.5rem", borderColor: "var(--red-7)" }}>
          <Text size="2" weight="medium" style={{ display: "block", marginBottom: "0.25rem" }}>
            Not ready to publish:
          </Text>
          {publishErrors.map((e, i) => (
            <Text key={i} size="2" style={{ display: "block", color: "var(--red-11)" }}>
              • {e.message}
            </Text>
          ))}
        </div>
      )}

      {/* Ledger */}
      <section className="profile-card" style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Heading size="4">Ledger</Heading>

        <LedgerField label="SKU description">
          <TextField.Root value={c.skuDescription} onChange={(e) => setC({ ...c, skuDescription: e.target.value })} />
        </LedgerField>

        <Separator size="4" />

        <TaggedField
          label="Sell price / unit"
          numericValue={c.sellPricePerUnit}
          onNumericChange={(v) => setC({ ...c, sellPricePerUnit: v })}
          tag={c.sellPriceTag}
          onTagChange={(tag) => setC({ ...c, sellPriceTag: tag })}
          sourceNote={c.sellPriceSourceNote}
          onSourceNoteChange={(v) => setC({ ...c, sellPriceSourceNote: v })}
          plannedTest={c.sellPricePlannedTest}
          onPlannedTestChange={(v) => setC({ ...c, sellPricePlannedTest: v })}
        />

        <TaggedField
          label="Target volume"
          numericValue={c.targetVolume}
          onNumericChange={(v) => setC({ ...c, targetVolume: v })}
          tag={c.targetVolumeTag}
          onTagChange={(tag) => setC({ ...c, targetVolumeTag: tag })}
          sourceNote={c.targetVolumeSourceNote}
          onSourceNoteChange={(v) => setC({ ...c, targetVolumeSourceNote: v })}
          plannedTest={c.targetVolumePlannedTest}
          onPlannedTestChange={(v) => setC({ ...c, targetVolumePlannedTest: v })}
        />

        <Separator size="4" />

        <LedgerField label="Kill margin % (kill if base margin falls below this)">
          <TextField.Root
            type="number"
            value={String(c.killMarginPct)}
            onChange={(e) => setC({ ...c, killMarginPct: Number(e.target.value) || 0 })}
          />
        </LedgerField>

        <LedgerField label="Kill demand metric (blank = demand not part of recommendation)">
          <TextField.Root value={c.killDemandMetric} onChange={(e) => setC({ ...c, killDemandMetric: e.target.value })} />
        </LedgerField>

        {c.killDemandMetric.trim().length > 0 && (
          <LedgerField label="Kill demand threshold">
            <TextField.Root
              type="number"
              value={c.killDemandThreshold === null ? "" : String(c.killDemandThreshold)}
              onChange={(e) => setC({ ...c, killDemandThreshold: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </LedgerField>
        )}

        <LedgerField label="Next cheapest test (shown on memo when recommendation is test_again)">
          <TextField.Root value={c.nextCheapestTest} onChange={(e) => setC({ ...c, nextCheapestTest: e.target.value })} />
        </LedgerField>

        <Separator size="4" />

        <LedgerField label="Founder verdict (never computed — you decide)">
          <Select.Root value={c.verdict} onValueChange={(v) => setC({ ...c, verdict: v as InvestmentCase["verdict"] })}>
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="unset">Unset</Select.Item>
              <Select.Item value="invest">Invest</Select.Item>
              <Select.Item value="test_again">Test again</Select.Item>
              <Select.Item value="kill">Kill</Select.Item>
            </Select.Content>
          </Select.Root>
        </LedgerField>

        <LedgerField label="Verdict rationale">
          <TextArea value={c.verdictNote} onChange={(e) => setC({ ...c, verdictNote: e.target.value })} />
        </LedgerField>

        {saveError && <Text size="2" color="red">{saveError}</Text>}
        <Button onClick={handleSaveLedger} disabled={saving} style={{ alignSelf: "flex-start" }}>
          {saving ? "Saving..." : "Save ledger"}
        </Button>
      </section>

      {/* Quotes */}
      <section className="profile-card" style={{ marginBottom: "1.5rem" }}>
        <Heading size="4" style={{ marginBottom: "0.75rem" }}>Supplier quotes</Heading>

        {quotes.map((q) => (
          <div key={q.$id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", padding: "0.5rem 0", borderBottom: "1px solid var(--gray-a5)" }}>
            <div style={{ minWidth: 0 }}>
              <Text size="2" weight="medium">{q.supplierName}</Text>{" "}
              {q.isPrimary && <Badge color="blue" size="1">primary</Badge>}
              <Text size="2" style={{ display: "block", color: "var(--foreground-muted)" }}>
                MOQ {q.moq} · FOB {fmtMoney(q.fobPerUnit, c.currency)} · freight {q.freightMode} {q.freightValue} · duty {q.dutyMode} {q.dutyValue}
                {!q.attachmentFileId && " · no attachment (won't count at publish)"}
              </Text>
              <div style={{ marginTop: "0.4rem" }}>
                <AttachmentControl
                  caseId={c.$id}
                  fileId={q.attachmentFileId}
                  targetKind="quote"
                  targetId={q.$id}
                  onChanged={refetch}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
              {!q.isPrimary && (
                <Button
                  variant="soft"
                  size="1"
                  onClick={() => handlePatchQuote(q.$id, { isPrimary: true })}
                >
                  Make primary
                </Button>
              )}
              <Button variant="soft" color="red" size="1" onClick={() => handleDeleteQuote(q.$id)}>Remove</Button>
            </div>
          </div>
        ))}

        <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <TextField.Root placeholder="Supplier name" value={newQuote.supplierName} onChange={(e) => setNewQuote({ ...newQuote, supplierName: e.target.value })} style={{ flex: "1 1 12rem" }} />
          <TextField.Root placeholder="MOQ" type="number" value={newQuote.moq} onChange={(e) => setNewQuote({ ...newQuote, moq: e.target.value })} style={{ width: "6rem" }} />
          <TextField.Root placeholder="FOB/unit" type="number" value={newQuote.fobPerUnit} onChange={(e) => setNewQuote({ ...newQuote, fobPerUnit: e.target.value })} style={{ width: "7rem" }} />
          <Select.Root value={newQuote.freightMode} onValueChange={(v) => setNewQuote({ ...newQuote, freightMode: v as "total" | "per_unit" })}>
            <Select.Trigger />
            <Select.Content><Select.Item value="total">freight total</Select.Item><Select.Item value="per_unit">freight/unit</Select.Item></Select.Content>
          </Select.Root>
          <TextField.Root placeholder="Freight" type="number" value={newQuote.freightValue} onChange={(e) => setNewQuote({ ...newQuote, freightValue: e.target.value })} style={{ width: "6rem" }} />
          <Select.Root value={newQuote.dutyMode} onValueChange={(v) => setNewQuote({ ...newQuote, dutyMode: v as "pct" | "per_unit" })}>
            <Select.Trigger />
            <Select.Content><Select.Item value="pct">duty %</Select.Item><Select.Item value="per_unit">duty/unit</Select.Item></Select.Content>
          </Select.Root>
          <TextField.Root placeholder="Duty" type="number" value={newQuote.dutyValue} onChange={(e) => setNewQuote({ ...newQuote, dutyValue: e.target.value })} style={{ width: "6rem" }} />
          <Text as="label" size="2" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Checkbox
              checked={newQuote.isPrimary}
              onCheckedChange={(v) => setNewQuote({ ...newQuote, isPrimary: v === true })}
            />
            primary
          </Text>
          <Button onClick={handleAddQuote}>Add quote</Button>
        </div>
        <Text size="1" style={{ color: "var(--foreground-muted)", display: "block", marginTop: "0.5rem" }}>
          A quote counts as complete for publish math once it has FOB, freight, duty, and an attached document. Add the quote first, then attach its document from the row above.
        </Text>
      </section>

      {/* Demand test */}
      <section className="profile-card" style={{ marginBottom: "1.5rem" }}>
        <Heading size="4" style={{ marginBottom: "0.75rem" }}>Demand test (one per case)</Heading>
        {/* Keyed so the form remounts when the row first comes into existence
            (or is deleted). Within a given row the key is stable, so a ledger
            save that refetches won't wipe what's being typed here. */}
        <DemandTestForm
          key={demandTest?.$id ?? "new"}
          caseId={c.$id}
          existing={demandTest}
          killDemandMetric={c.killDemandMetric}
          onSaved={refetch}
        />
      </section>

      {/* Scenarios */}
      <section style={{ marginBottom: "1.5rem" }}>
        <Heading size="4" style={{ marginBottom: "0.75rem" }}>Scenarios</Heading>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <ScenarioCard label="Downside" result={scenarios.downside} currency={c.currency} />
          <ScenarioCard label="Base" result={scenarios.base} currency={c.currency} />
          <ScenarioCard label="Upside" result={scenarios.upside} currency={c.currency} />
        </div>
      </section>

      {/* Memo */}
      <section className="profile-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Heading size="4">Dad Decision Memo</Heading>
          <Button variant="soft" onClick={handleLoadMemo}>{memo ? "Refresh" : "Load memo"}</Button>
        </div>
        {memo && <MemoView memo={memo} onPrint={() => window.print()} />}
      </section>
    </div>
  );
}

function LedgerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <Text size="2" style={{ color: "var(--foreground-muted)" }}>{label}</Text>
      {children}
    </label>
  );
}

function TaggedField({
  label,
  numericValue,
  onNumericChange,
  tag,
  onTagChange,
  sourceNote,
  onSourceNoteChange,
  plannedTest,
  onPlannedTestChange,
}: {
  label: string;
  numericValue: number | null;
  onNumericChange: (v: number | null) => void;
  tag: EvidenceTag;
  onTagChange: (tag: EvidenceTag) => void;
  sourceNote: string;
  onSourceNoteChange: (v: string) => void;
  plannedTest: string;
  onPlannedTestChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <Text size="2" weight="medium">{label}</Text>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <TextField.Root
          type="number"
          placeholder="Value"
          value={numericValue === null ? "" : String(numericValue)}
          onChange={(e) => onNumericChange(e.target.value === "" ? null : Number(e.target.value))}
          style={{ width: "8rem" }}
        />
        <Select.Root value={tag} onValueChange={(v) => onTagChange(v as EvidenceTag)}>
          <Select.Trigger />
          <Select.Content>
            <Select.Item value="Quoted">Quoted</Select.Item>
            <Select.Item value="Measured">Measured</Select.Item>
            <Select.Item value="Untested">Untested</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
      {tag === "Untested" ? (
        <TextField.Root
          placeholder="Planned test (required to publish)"
          value={plannedTest}
          onChange={(e) => onPlannedTestChange(e.target.value)}
        />
      ) : (
        <TextField.Root
          placeholder="Source note (required to publish when Quoted)"
          value={sourceNote}
          onChange={(e) => onSourceNoteChange(e.target.value)}
        />
      )}
    </div>
  );
}

function DemandTestForm({
  caseId,
  existing,
  killDemandMetric,
  onSaved,
}: {
  caseId: string;
  existing: CaseDemandTest | null;
  killDemandMetric: string;
  onSaved: () => Promise<void>;
}) {
  const [hypothesis, setHypothesis] = useState(existing?.hypothesis ?? "");
  const [method, setMethod] = useState<CaseDemandTest["method"]>(existing?.method ?? "preorder");
  const [ownMetricName, setOwnMetricName] = useState(existing?.metricName ?? "");
  const [status, setStatus] = useState<CaseDemandTest["status"]>(existing?.status ?? "planned");
  const [result, setResult] = useState(existing?.result === null || existing?.result === undefined ? "" : String(existing.result));
  const [error, setError] = useState<string | null>(null);

  // When the case sets a killDemandMetric, the server *forces* the demand
  // test's metricName to match it and 400s on anything else. Deriving the value
  // instead of holding it in state removes that failure entirely — previously
  // this was seeded from a prop once at mount, so editing killDemandMetric in
  // the ledger left this form holding the old name and every save was rejected.
  const metricLocked = killDemandMetric.trim().length > 0;
  const metricName = metricLocked ? killDemandMetric : ownMetricName;

  async function handleSave() {
    setError(null);
    const res = await fetch(`/api/investment-cases/${caseId}/demand-test`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hypothesis,
        method,
        metricName,
        status,
        result: result === "" ? null : Number(result),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to save demand test");
      return;
    }
    await onSaved();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <TextField.Root placeholder="Hypothesis" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Select.Root value={method} onValueChange={(v) => setMethod(v as CaseDemandTest["method"])}>
          <Select.Trigger />
          <Select.Content>
            {["landing", "preorder", "outreach", "interview", "other"].map((m) => (
              <Select.Item key={m} value={m}>{m}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <TextField.Root
          placeholder="Metric name"
          value={metricName}
          onChange={(e) => setOwnMetricName(e.target.value)}
          disabled={metricLocked}
          title={metricLocked ? "Follows the case's kill demand metric" : undefined}
        />
        <Select.Root value={status} onValueChange={(v) => setStatus(v as CaseDemandTest["status"])}>
          <Select.Trigger />
          <Select.Content>
            <Select.Item value="planned">planned</Select.Item>
            <Select.Item value="running">running</Select.Item>
            <Select.Item value="done">done</Select.Item>
          </Select.Content>
        </Select.Root>
        <TextField.Root placeholder="Result (once done)" type="number" value={result} onChange={(e) => setResult(e.target.value)} style={{ width: "8rem" }} />
      </div>
      {metricLocked && (
        <Text size="1" style={{ color: "var(--foreground-muted)" }}>
          Metric name follows the case&apos;s kill demand metric ({killDemandMetric}). Change it in the ledger above.
        </Text>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <Text size="2" style={{ color: "var(--foreground-muted)" }}>Evidence:</Text>
        <AttachmentControl
          caseId={caseId}
          fileId={existing?.evidenceFileId ?? null}
          targetKind="demand-test"
          onChanged={onSaved}
          disabled={!existing}
          disabledHint="Create the demand test before attaching evidence."
        />
      </div>

      {error && <Text size="2" color="red">{error}</Text>}
      <Button onClick={handleSave} style={{ alignSelf: "flex-start" }}>
        {existing ? "Update demand test" : "Create demand test"}
      </Button>
    </div>
  );
}

function MemoView({ memo, onPrint }: { memo: CaseMemo; onPrint: () => void }) {
  return (
    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <Text size="2" style={{ fontStyle: "italic", color: "var(--foreground-muted)" }}>{memo.disclaimer}</Text>

      <div>
        <Text size="2" weight="medium">Verdict / recommendation</Text>
        <Text size="2" style={{ display: "block" }}>
          Founder: {memo.verdict} · System: {memo.systemRecommendation ?? "—"}
        </Text>
      </div>

      <div>
        <Text size="2" weight="medium">Base unit economics</Text>
        {memo.base ? (
          <Text size="2" style={{ display: "block" }}>
            Landed {fmtMoney(memo.base.landedPerUnit, memo.currency)} · margin {fmtPct(memo.base.landedMarginPct)} ·
            {" "}capital {fmtMoney(memo.base.capitalRequired, memo.currency)} · break-even {fmtUnits(memo.base.breakEvenUnits)} units
          </Text>
        ) : (
          <Text size="2" style={{ color: "var(--foreground-muted)" }}>No primary quote yet.</Text>
        )}
      </div>

      <div>
        <Text size="2" weight="medium">Knowns</Text>
        {memo.knowns.length === 0 && <Text size="2" style={{ color: "var(--foreground-muted)" }}>None yet.</Text>}
        {memo.knowns.map((k) => (
          <Text key={k.field} size="2" style={{ display: "block" }}>• {k.field}: {k.value} ({k.tag} — {k.source || "no source note"})</Text>
        ))}
      </div>

      <div>
        <Text size="2" weight="medium">Unknowns</Text>
        {memo.unknowns.length === 0 && <Text size="2" style={{ color: "var(--foreground-muted)" }}>None.</Text>}
        {memo.unknowns.map((u) => (
          <Text key={u.field} size="2" style={{ display: "block" }}>• {u.field} — planned test: {u.plannedTest || "not set"}</Text>
        ))}
      </div>

      <div>
        <Text size="2" weight="medium">Demand test</Text>
        {memo.demandTest ? (
          <Text size="2" style={{ display: "block" }}>
            {memo.demandTest.hypothesis} — {memo.demandTest.status}, result {memo.demandTest.result ?? "pending"} vs threshold {memo.demandTest.threshold ?? "—"}
          </Text>
        ) : (
          <Text size="2" style={{ color: "var(--foreground-muted)" }}>No demand test yet.</Text>
        )}
      </div>

      <div>
        <Text size="2" weight="medium">Kill criteria</Text>
        <Text size="2" style={{ display: "block" }}>
          Margin floor {memo.killCriteria.killMarginPct}%
          {memo.killCriteria.killDemandMetric && ` · demand ${memo.killCriteria.killDemandMetric} ≥ ${memo.killCriteria.killDemandThreshold}`}
        </Text>
      </div>

      {memo.nextCheapestTest && (
        <div>
          <Text size="2" weight="medium">Next cheapest test</Text>
          <Text size="2" style={{ display: "block" }}>{memo.nextCheapestTest}</Text>
        </div>
      )}

      <Button variant="soft" onClick={onPrint} style={{ alignSelf: "flex-start" }}>Print / save PDF</Button>
    </div>
  );
}
