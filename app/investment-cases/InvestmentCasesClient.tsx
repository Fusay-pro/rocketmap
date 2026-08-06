"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Heading, Text, TextField, Badge } from "@radix-ui/themes";
import type { InvestmentCase } from "@/lib/types/investment-case";

interface InvestmentCasesClientProps {
  cases: InvestmentCase[];
  /** Set when the list query failed, so a broken setup can't read as "none yet". */
  loadError?: string | null;
}

const VERDICT_COLOR: Record<InvestmentCase["verdict"], "green" | "amber" | "red" | "gray"> = {
  invest: "green",
  test_again: "amber",
  kill: "red",
  unset: "gray",
};

export function InvestmentCasesClient({ cases, loadError = null }: InvestmentCasesClientProps) {
  const router = useRouter();
  // Don't auto-open the create form when the list merely failed to load —
  // inviting a new case on top of a broken query hides the real problem.
  const [showForm, setShowForm] = useState(cases.length === 0 && !loadError);
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [skuDescription, setSkuDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim() || !currency.trim()) {
      setError("Title and currency are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/investment-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, currency, skuDescription }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create case");
      router.push(`/investment-cases/${data.$id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create case");
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <Heading size="8" style={{ fontFamily: "var(--font-display)", fontWeight: 400, marginBottom: "0.25rem" }}>
          Investment Cases
        </Heading>
        <Text size="2" style={{ color: "var(--foreground-muted)" }}>
          Every load-bearing number here is Quoted, Measured, or Untested with a named test.
          The AI never writes these numbers.
        </Text>
      </div>

      {loadError && (
        <div
          role="alert"
          className="profile-card"
          style={{ marginBottom: "1.5rem", borderColor: "var(--state-critical)" }}
        >
          <Text size="2" weight="medium" style={{ display: "block", color: "var(--state-critical)" }}>
            Couldn&apos;t load your investment cases
          </Text>
          <Text size="2" style={{ color: "var(--foreground-muted)" }}>
            {loadError}
          </Text>
        </div>
      )}

      {!showForm && (
        <Button size="3" onClick={() => setShowForm(true)} style={{ marginBottom: "1.5rem" }}>
          New investment case
        </Button>
      )}

      {showForm && (
        <div className="profile-card" style={{ marginBottom: "2rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Heading size="4">New investment case</Heading>
          <TextField.Root
            placeholder="Venture / SKU name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField.Root
            placeholder="Currency (e.g. USD)"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
          />
          <TextField.Root
            placeholder="SKU description (optional)"
            value={skuDescription}
            onChange={(e) => setSkuDescription(e.target.value)}
          />
          {error && <Text size="2" color="red">{error}</Text>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? "Creating..." : "Create draft"}
            </Button>
            {cases.length > 0 && (
              <Button variant="soft" color="gray" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {cases.length === 0 && !showForm ? (
        <Text size="2" style={{ color: "var(--foreground-muted)" }}>
          {loadError ? "List unavailable — see the error above." : "No investment cases yet."}
        </Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {cases.map((c) => (
            <Link
              key={c.$id}
              href={`/investment-cases/${c.$id}`}
              className="profile-card"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none" }}
            >
              <div>
                <Text size="4" weight="medium" style={{ display: "block" }}>
                  {c.title}
                </Text>
                <Text size="2" style={{ color: "var(--foreground-muted)" }}>
                  {c.currency} · {c.skuDescription || "No SKU description"}
                </Text>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <Badge color={c.status === "published" ? "green" : "gray"}>{c.status}</Badge>
                {c.verdict !== "unset" && (
                  <Badge color={VERDICT_COLOR[c.verdict]}>{c.verdict.replace("_", " ")}</Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
