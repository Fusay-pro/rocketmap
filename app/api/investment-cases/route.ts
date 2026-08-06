import { NextResponse } from "next/server";
import { ID, Query } from "node-appwrite";
import { requireAuth } from "@/lib/appwrite-server";
import { serverTablesDB, DATABASE_ID, INVESTMENT_CASES_TABLE_ID } from "@/lib/appwrite";
import { parseInvestmentCaseRow } from "@/lib/investment-case/db";

export async function GET() {
  try {
    const user = await requireAuth();

    const result = await serverTablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: INVESTMENT_CASES_TABLE_ID,
      queries: [
        Query.equal("userId", user.$id),
        Query.orderDesc("$updatedAt"),
        Query.limit(100),
      ],
    });

    return NextResponse.json({ cases: result.rows.map(parseInvestmentCaseRow) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { title, currency, skuDescription } = body as {
      title?: string;
      currency?: string;
      skuDescription?: string;
    };

    if (!title || typeof title !== "string") {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!currency || typeof currency !== "string") {
      return NextResponse.json({ error: "Currency is required" }, { status: 400 });
    }

    const now = new Date().toISOString();

    const doc = await serverTablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: INVESTMENT_CASES_TABLE_ID,
      rowId: ID.unique(),
      data: {
        userId: user.$id,
        status: "draft",
        publishedAt: null,
        title: title.trim(),
        currency: currency.trim(),
        skuDescription: skuDescription?.trim() ?? "",
        targetVolume: null,
        targetVolumeTag: "Untested",
        targetVolumeSourceNote: "",
        targetVolumePlannedTest: "",
        sellPricePerUnit: null,
        sellPriceTag: "Untested",
        sellPriceSourceNote: "",
        sellPricePlannedTest: "",
        capitalAvailable: null,
        killMarginPct: 20,
        killDemandMetric: "",
        killDemandThreshold: null,
        nextCheapestTest: "",
        verdict: "unset",
        verdictNote: "",
        systemRecommendation: "test_again",
        createdAt: now,
        updatedAt: now,
      },
    });

    return NextResponse.json({ $id: doc.$id }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
