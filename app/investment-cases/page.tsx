import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/appwrite-server";
import { serverTablesDB, DATABASE_ID, INVESTMENT_CASES_TABLE_ID } from "@/lib/appwrite";
import { Query } from "node-appwrite";
import { parseInvestmentCaseRow } from "@/lib/investment-case/db";
import { InvestmentCasesClient } from "./InvestmentCasesClient";

export default async function InvestmentCasesPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/?error=unauthorized");
  }

  let cases: ReturnType<typeof parseInvestmentCaseRow>[] = [];
  let loadError: string | null = null;

  try {
    const result = await serverTablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: INVESTMENT_CASES_TABLE_ID,
      queries: [
        Query.equal("userId", user.$id),
        Query.orderDesc("$updatedAt"),
        Query.limit(100),
      ],
    });
    cases = result.rows.map(parseInvestmentCaseRow);
  } catch (error: unknown) {
    // This used to swallow everything into an empty list, which made a missing
    // table, a broken index, and a permissions problem all look identical to
    // "no cases yet" — the failure mode that hides a setup bug for weeks.
    const e = error as { code?: number; type?: string; message?: string };
    console.error(
      `[investment-cases] list failed: code=${e?.code} type=${e?.type} message=${e?.message ?? String(error)}`,
    );
    loadError =
      e?.code === 404
        ? "The investment_cases table doesn't exist yet. Run scripts/setup-investment-case-db.ts."
        : `Couldn't load your cases: ${e?.message ?? "unknown error"}`;
  }

  return <InvestmentCasesClient cases={cases} loadError={loadError} />;
}
