import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/appwrite-server";
import { loadFullCase } from "@/lib/investment-case/db";
import { buildCaseMemo } from "@/lib/investment-case/memo";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

function statusFor(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message === "Forbidden") return 403;
  if (message === "Not found") return 404;
  return 500;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId } = await context.params;
    const full = await loadFullCase(caseId, user.$id);
    return NextResponse.json(buildCaseMemo(full));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
