import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/appwrite-server";
import { loadFullCase, type FullCase } from "@/lib/investment-case/db";
import { CaseDetailClient } from "./CaseDetailClient";

interface PageProps {
  params: Promise<{ caseId: string }>;
}

async function loadOrNotFound(caseId: string, userId: string): Promise<FullCase> {
  try {
    return await loadFullCase(caseId, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Forbidden" || message === "Not found") {
      notFound();
    }
    throw error;
  }
}

export default async function InvestmentCaseDetailPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/?error=unauthorized");
  }

  const { caseId } = await params;
  const full = await loadOrNotFound(caseId, user.$id);

  return (
    <CaseDetailClient
      initialCase={full.investmentCase}
      initialQuotes={full.quotes}
      initialDemandTest={full.demandTest}
      initialScenarios={full.scenarios}
    />
  );
}
