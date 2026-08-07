import { Query } from "node-appwrite";
import {
  serverTablesDB,
  DATABASE_ID,
  INVESTMENT_CASES_TABLE_ID,
  CASE_QUOTES_TABLE_ID,
  CASE_DEMAND_TESTS_TABLE_ID,
} from "@/lib/appwrite";
import { computeCaseScenarios, computeSystemRecommendation } from "@/lib/investment-case/formulas";
import type {
  CaseDemandTest,
  CaseQuote,
  CaseScenarios,
  InvestmentCase,
  SystemRecommendation,
} from "@/lib/types/investment-case";

type Row = Record<string, unknown>;

function str(row: Row, field: string, fallback = ""): string {
  return typeof row[field] === "string" ? (row[field] as string) : fallback;
}

function numOrNull(row: Row, field: string): number | null {
  return typeof row[field] === "number" ? (row[field] as number) : null;
}

function num(row: Row, field: string, fallback = 0): number {
  return typeof row[field] === "number" ? (row[field] as number) : fallback;
}

function bool(row: Row, field: string, fallback = false): boolean {
  return typeof row[field] === "boolean" ? (row[field] as boolean) : fallback;
}

export function parseInvestmentCaseRow(row: Row): InvestmentCase {
  return {
    $id: row.$id as string,
    userId: str(row, "userId"),
    status: (row.status as InvestmentCase["status"]) ?? "draft",
    publishedAt: (row.publishedAt as string) ?? null,
    title: str(row, "title"),
    currency: str(row, "currency", "USD"),
    skuDescription: str(row, "skuDescription"),
    targetVolume: numOrNull(row, "targetVolume"),
    targetVolumeTag: (row.targetVolumeTag as InvestmentCase["targetVolumeTag"]) ?? "Untested",
    targetVolumeSourceNote: str(row, "targetVolumeSourceNote"),
    targetVolumePlannedTest: str(row, "targetVolumePlannedTest"),
    sellPricePerUnit: numOrNull(row, "sellPricePerUnit"),
    sellPriceTag: (row.sellPriceTag as InvestmentCase["sellPriceTag"]) ?? "Untested",
    sellPriceSourceNote: str(row, "sellPriceSourceNote"),
    sellPricePlannedTest: str(row, "sellPricePlannedTest"),
    capitalAvailable: numOrNull(row, "capitalAvailable"),
    killMarginPct: num(row, "killMarginPct"),
    killDemandMetric: str(row, "killDemandMetric"),
    killDemandThreshold: numOrNull(row, "killDemandThreshold"),
    nextCheapestTest: str(row, "nextCheapestTest"),
    verdict: (row.verdict as InvestmentCase["verdict"]) ?? "unset",
    verdictNote: str(row, "verdictNote"),
    systemRecommendation: (row.systemRecommendation as InvestmentCase["systemRecommendation"]) ?? null,
    createdAt: str(row, "createdAt"),
    updatedAt: str(row, "updatedAt"),
  };
}

export function parseCaseQuoteRow(row: Row): CaseQuote {
  const caseField = row.case;
  const caseId = typeof caseField === "string" ? caseField : (caseField as { $id?: string })?.$id ?? "";

  return {
    $id: row.$id as string,
    caseId,
    supplierName: str(row, "supplierName"),
    moq: num(row, "moq"),
    fobPerUnit: num(row, "fobPerUnit"),
    freightMode: (row.freightMode as CaseQuote["freightMode"]) ?? "total",
    freightValue: num(row, "freightValue"),
    dutyMode: (row.dutyMode as CaseQuote["dutyMode"]) ?? "pct",
    dutyValue: num(row, "dutyValue"),
    leadTimeDays: numOrNull(row, "leadTimeDays"),
    paymentTerms: str(row, "paymentTerms"),
    attachmentFileId: (row.attachmentFileId as string) || null,
    quoteDate: str(row, "quoteDate"),
    isPrimary: bool(row, "isPrimary"),
  };
}

export function parseCaseDemandTestRow(row: Row): CaseDemandTest {
  const caseField = row.case;
  const caseId = typeof caseField === "string" ? caseField : (caseField as { $id?: string })?.$id ?? "";

  return {
    $id: row.$id as string,
    caseId,
    hypothesis: str(row, "hypothesis"),
    method: (row.method as CaseDemandTest["method"]) ?? "other",
    metricName: str(row, "metricName"),
    threshold: numOrNull(row, "threshold"),
    result: numOrNull(row, "result"),
    sampleSize: numOrNull(row, "sampleSize"),
    status: (row.status as CaseDemandTest["status"]) ?? "planned",
    evidenceFileId: (row.evidenceFileId as string) || null,
  };
}

/** Throws 'Unauthorized'-shaped 'Forbidden' if the case doesn't exist or isn't owned by userId. */
export async function verifyCaseOwnership(caseId: string, userId: string): Promise<InvestmentCase> {
  let row: Row;
  try {
    row = await serverTablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: INVESTMENT_CASES_TABLE_ID,
      rowId: caseId,
    });
  } catch {
    throw new Error("Not found");
  }

  if (str(row, "userId") !== userId) {
    throw new Error("Forbidden");
  }

  return parseInvestmentCaseRow(row);
}

export async function listQuotesForCase(caseId: string): Promise<CaseQuote[]> {
  const result = await serverTablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: CASE_QUOTES_TABLE_ID,
    queries: [Query.equal("case", caseId), Query.limit(50)],
  });
  return result.rows.map(parseCaseQuoteRow);
}

/**
 * Every demand test on a case, oldest first.
 *
 * The spec says at most one, but nothing in Appwrite enforces it — a
 * relationship column can't carry a unique index, and the upsert in
 * PUT .../demand-test is a read-then-write, so two concurrent saves can both
 * miss and both create. Callers that need to *detect* that use this; callers
 * that just need the record use getDemandTestForCase.
 */
export async function listDemandTestsForCase(caseId: string): Promise<CaseDemandTest[]> {
  const result = await serverTablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: CASE_DEMAND_TESTS_TABLE_ID,
    queries: [Query.equal("case", caseId), Query.orderAsc("$id"), Query.limit(25)],
  });
  return result.rows.map(parseCaseDemandTestRow);
}

/**
 * The case's demand test, or null.
 *
 * Ordered by $id rather than taking whatever limit(1) returns. If duplicates
 * ever exist, an unordered read could hand back a different row on successive
 * calls, so the memo, the scenarios and the publish gate could each disagree
 * about which numbers are real. Oldest-wins is arbitrary but stable, and
 * publish refuses outright when it sees more than one.
 */
export async function getDemandTestForCase(caseId: string): Promise<CaseDemandTest | null> {
  const result = await serverTablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: CASE_DEMAND_TESTS_TABLE_ID,
    queries: [Query.equal("case", caseId), Query.orderAsc("$id"), Query.limit(1)],
  });
  return result.rows.length > 0 ? parseCaseDemandTestRow(result.rows[0]) : null;
}

/** Throws 'Forbidden' if the quote does not belong to the given case. */
export async function verifyQuoteBelongsToCase(caseId: string, quoteId: string): Promise<CaseQuote> {
  let row: Row;
  try {
    row = await serverTablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: CASE_QUOTES_TABLE_ID,
      rowId: quoteId,
    });
  } catch {
    throw new Error("Not found");
  }

  const quote = parseCaseQuoteRow(row);
  if (quote.caseId !== caseId) {
    throw new Error("Forbidden");
  }
  return quote;
}

export interface FullCase {
  investmentCase: InvestmentCase;
  quotes: CaseQuote[];
  demandTest: CaseDemandTest | null;
  scenarios: CaseScenarios;
  systemRecommendation: SystemRecommendation;
}

/**
 * Loads a case with its quotes + demand test, recomputes scenarios and the
 * system recommendation live (spec §4.1: "computed on every read, never
 * cached"), and best-effort persists the recommendation snapshot so list
 * views can show it without re-fetching quotes for every row.
 */
export async function loadFullCase(caseId: string, userId: string): Promise<FullCase> {
  const investmentCase = await verifyCaseOwnership(caseId, userId);
  const [quotes, demandTest] = await Promise.all([
    listQuotesForCase(caseId),
    getDemandTestForCase(caseId),
  ]);

  const scenarios = computeCaseScenarios(investmentCase, quotes, demandTest);
  const systemRecommendation = computeSystemRecommendation(investmentCase, scenarios, demandTest);

  if (systemRecommendation !== investmentCase.systemRecommendation) {
    try {
      await serverTablesDB.updateRow({
        databaseId: DATABASE_ID,
        tableId: INVESTMENT_CASES_TABLE_ID,
        rowId: caseId,
        data: { systemRecommendation },
      });
    } catch {
      // Best-effort snapshot — the live value returned below is still correct either way.
    }
  }

  return {
    investmentCase: { ...investmentCase, systemRecommendation },
    quotes,
    demandTest,
    scenarios,
    systemRecommendation,
  };
}

/** Spec §4.2: exactly one primary quote at a time. */
export async function unsetOtherPrimaryQuotes(caseId: string, exceptQuoteId: string): Promise<void> {
  const quotes = await listQuotesForCase(caseId);
  const others = quotes.filter((q) => q.isPrimary && q.$id !== exceptQuoteId);
  await Promise.all(
    others.map((q) =>
      serverTablesDB.updateRow({
        databaseId: DATABASE_ID,
        tableId: CASE_QUOTES_TABLE_ID,
        rowId: q.$id,
        data: { isPrimary: false },
      }),
    ),
  );
}

export function isForbiddenError(error: unknown): boolean {
  return error instanceof Error && error.message === "Forbidden";
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message === "Not found";
}
