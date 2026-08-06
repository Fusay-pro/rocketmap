/**
 * One-off setup script for the Investment Case module (docs/INVESTMENT_CASE_SPEC.md §2).
 * Uses the current TablesDB API only (never the deprecated Databases/Collections API).
 *
 * Usage:
 *   node --env-file=.env.local scripts/setup-investment-case-db.ts
 *
 * Idempotent: every create call is wrapped so a 409 (already exists) is
 * logged and skipped rather than aborting the run. Safe to re-run.
 */
import {
  Client,
  TablesDB,
  IndexType,
  RelationshipType,
  RelationMutate,
} from "node-appwrite";

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const INVESTMENT_CASES_TABLE_ID = "investment_cases";
const CASE_QUOTES_TABLE_ID = "case_quotes";
const CASE_DEMAND_TESTS_TABLE_ID = "case_demand_tests";

/**
 * Server-only. Deliberately empty.
 *
 * Every read/write to these tables goes through an API route that calls
 * `serverTablesDB` with an API key, and an API key bypasses table permissions
 * entirely — so granting anything here buys no functionality.
 *
 * What it *would* buy is a hole: `Role.users()` grants the permission to every
 * authenticated account in the project, and with `rowSecurity: false` there is
 * no per-row narrowing behind it. Any signed-in user could then read, edit, or
 * delete any other user's investment case straight from the client SDK using
 * the public `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, never touching the routes where
 * `verifyCaseOwnership` lives. Ownership is enforced in the route layer, so the
 * database layer must not offer a way around it.
 */
const SERVER_ONLY_PERMISSIONS: string[] = [];

function isConflict(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 409;
}

async function ignoreConflict(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (isConflict(e)) {
      console.log(`  (already exists, skipping) ${label}`);
    } else {
      console.error(`  Failed: ${label}`);
      throw e;
    }
  }
}

async function waitForColumns(tablesDB: TablesDB, tableId: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const table = await tablesDB.getTable({ databaseId: DATABASE_ID, tableId });
    const pending = table.columns.filter((c) => c.status !== "available");
    if (pending.length === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for columns on "${tableId}" to become available`);
}

async function setup() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);

  const tablesDB = new TablesDB(client);

  console.log("Using database:", DATABASE_ID);

  // ─── 1. investment_cases ────────────────────────────────────────────────
  await ignoreConflict("table: investment_cases", () =>
    tablesDB.createTable({
      databaseId: DATABASE_ID,
      tableId: INVESTMENT_CASES_TABLE_ID,
      name: "Investment Cases",
      permissions: SERVER_ONLY_PERMISSIONS,
      rowSecurity: false,
    }),
  );
  console.log("Created table: investment_cases");

  const caseColumns: Array<[string, () => Promise<unknown>]> = [
    ["userId", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "userId", size: 36, required: true })],
    ["status", () => tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "status", elements: ["draft", "published"], required: true })],
    ["publishedAt", () => tablesDB.createDatetimeColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "publishedAt", required: false })],
    ["title", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "title", size: 256, required: true })],
    ["currency", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "currency", size: 8, required: true })],
    ["skuDescription", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "skuDescription", size: 1000, required: false, xdefault: "" })],
    ["targetVolume", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "targetVolume", required: false })],
    ["targetVolumeTag", () => tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "targetVolumeTag", elements: ["Quoted", "Measured", "Untested"], required: false, xdefault: "Untested" })],
    ["targetVolumeSourceNote", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "targetVolumeSourceNote", size: 500, required: false, xdefault: "" })],
    ["targetVolumePlannedTest", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "targetVolumePlannedTest", size: 500, required: false, xdefault: "" })],
    ["sellPricePerUnit", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "sellPricePerUnit", required: false })],
    ["sellPriceTag", () => tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "sellPriceTag", elements: ["Quoted", "Measured", "Untested"], required: false, xdefault: "Untested" })],
    ["sellPriceSourceNote", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "sellPriceSourceNote", size: 500, required: false, xdefault: "" })],
    ["sellPricePlannedTest", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "sellPricePlannedTest", size: 500, required: false, xdefault: "" })],
    ["capitalAvailable", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "capitalAvailable", required: false })],
    ["killMarginPct", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "killMarginPct", required: false, xdefault: 20 })],
    ["killDemandMetric", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "killDemandMetric", size: 200, required: false, xdefault: "" })],
    ["killDemandThreshold", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "killDemandThreshold", required: false })],
    ["nextCheapestTest", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "nextCheapestTest", size: 500, required: false, xdefault: "" })],
    ["verdict", () => tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "verdict", elements: ["invest", "test_again", "kill", "unset"], required: false, xdefault: "unset" })],
    ["verdictNote", () => tablesDB.createLongtextColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "verdictNote", required: false })],
    ["systemRecommendation", () => tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "systemRecommendation", elements: ["invest", "test_again", "kill"], required: false })],
    ["createdAt", () => tablesDB.createDatetimeColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "createdAt", required: true })],
    ["updatedAt", () => tablesDB.createDatetimeColumn({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "updatedAt", required: true })],
  ];
  for (const [label, create] of caseColumns) await ignoreConflict(label, create);
  console.log("Created investment_cases columns, waiting for them to become available...");
  await waitForColumns(tablesDB, INVESTMENT_CASES_TABLE_ID);

  await ignoreConflict("index: investment_cases.userId", () =>
    tablesDB.createIndex({ databaseId: DATABASE_ID, tableId: INVESTMENT_CASES_TABLE_ID, key: "userId_idx", type: IndexType.Key, columns: ["userId"] }),
  );
  console.log("Created investment_cases index\n");

  // ─── 2. case_quotes ─────────────────────────────────────────────────────
  await ignoreConflict("table: case_quotes", () =>
    tablesDB.createTable({
      databaseId: DATABASE_ID,
      tableId: CASE_QUOTES_TABLE_ID,
      name: "Case Quotes",
      permissions: SERVER_ONLY_PERMISSIONS,
      rowSecurity: false,
    }),
  );
  console.log("Created table: case_quotes");

  await ignoreConflict("relationship: case_quotes.case -> investment_cases", () =>
    tablesDB.createRelationshipColumn({
      databaseId: DATABASE_ID,
      tableId: CASE_QUOTES_TABLE_ID,
      relatedTableId: INVESTMENT_CASES_TABLE_ID,
      type: RelationshipType.ManyToOne,
      twoWay: true,
      key: "case",
      twoWayKey: "quotes",
      onDelete: RelationMutate.Cascade,
    }),
  );

  const quoteColumns: Array<[string, () => Promise<unknown>]> = [
    ["supplierName", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "supplierName", size: 256, required: true })],
    ["moq", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "moq", required: true })],
    ["fobPerUnit", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "fobPerUnit", required: true })],
    ["freightMode", () => tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "freightMode", elements: ["total", "per_unit"], required: true })],
    ["freightValue", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "freightValue", required: false, xdefault: 0 })],
    ["dutyMode", () => tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "dutyMode", elements: ["pct", "per_unit"], required: true })],
    ["dutyValue", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "dutyValue", required: false, xdefault: 0 })],
    ["leadTimeDays", () => tablesDB.createIntegerColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "leadTimeDays", required: false })],
    ["paymentTerms", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "paymentTerms", size: 200, required: false, xdefault: "" })],
    ["attachmentFileId", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "attachmentFileId", size: 64, required: false })],
    ["quoteDate", () => tablesDB.createDatetimeColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "quoteDate", required: true })],
    ["isPrimary", () => tablesDB.createBooleanColumn({ databaseId: DATABASE_ID, tableId: CASE_QUOTES_TABLE_ID, key: "isPrimary", required: false, xdefault: false })],
  ];
  for (const [label, create] of quoteColumns) await ignoreConflict(label, create);
  console.log("Created case_quotes columns, waiting for them to become available...");
  await waitForColumns(tablesDB, CASE_QUOTES_TABLE_ID);
  // No explicit index on `case`: Appwrite auto-indexes relationship columns
  // and rejects a manual createIndex call on one (column_type_invalid).
  console.log("case_quotes ready (relationship column is auto-indexed)\n");

  // ─── 3. case_demand_tests ───────────────────────────────────────────────
  await ignoreConflict("table: case_demand_tests", () =>
    tablesDB.createTable({
      databaseId: DATABASE_ID,
      tableId: CASE_DEMAND_TESTS_TABLE_ID,
      name: "Case Demand Tests",
      permissions: SERVER_ONLY_PERMISSIONS,
      rowSecurity: false,
    }),
  );
  console.log("Created table: case_demand_tests");

  await ignoreConflict("relationship: case_demand_tests.case -> investment_cases", () =>
    tablesDB.createRelationshipColumn({
      databaseId: DATABASE_ID,
      tableId: CASE_DEMAND_TESTS_TABLE_ID,
      relatedTableId: INVESTMENT_CASES_TABLE_ID,
      type: RelationshipType.ManyToOne,
      twoWay: true,
      key: "case",
      twoWayKey: "demandTests",
      onDelete: RelationMutate.Cascade,
    }),
  );

  const demandTestColumns: Array<[string, () => Promise<unknown>]> = [
    ["hypothesis", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: CASE_DEMAND_TESTS_TABLE_ID, key: "hypothesis", size: 1000, required: true })],
    ["method", () => tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId: CASE_DEMAND_TESTS_TABLE_ID, key: "method", elements: ["landing", "preorder", "outreach", "interview", "other"], required: true })],
    ["metricName", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: CASE_DEMAND_TESTS_TABLE_ID, key: "metricName", size: 200, required: true })],
    ["threshold", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: CASE_DEMAND_TESTS_TABLE_ID, key: "threshold", required: false })],
    ["result", () => tablesDB.createFloatColumn({ databaseId: DATABASE_ID, tableId: CASE_DEMAND_TESTS_TABLE_ID, key: "result", required: false })],
    ["sampleSize", () => tablesDB.createIntegerColumn({ databaseId: DATABASE_ID, tableId: CASE_DEMAND_TESTS_TABLE_ID, key: "sampleSize", required: false })],
    ["status", () => tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId: CASE_DEMAND_TESTS_TABLE_ID, key: "status", elements: ["planned", "running", "done"], required: true })],
    ["evidenceFileId", () => tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId: CASE_DEMAND_TESTS_TABLE_ID, key: "evidenceFileId", size: 64, required: false })],
  ];
  for (const [label, create] of demandTestColumns) await ignoreConflict(label, create);
  console.log("Created case_demand_tests columns, waiting for them to become available...");
  await waitForColumns(tablesDB, CASE_DEMAND_TESTS_TABLE_ID);
  // Same reason as case_quotes above: relationship columns are auto-indexed.
  console.log("case_demand_tests ready (relationship column is auto-indexed)\n");

  // ─── Sanity check: each table is actually queryable ────────────────────
  for (const tableId of [INVESTMENT_CASES_TABLE_ID, CASE_QUOTES_TABLE_ID, CASE_DEMAND_TESTS_TABLE_ID]) {
    const result = await tablesDB.listRows({ databaseId: DATABASE_ID, tableId, queries: [] });
    console.log(`Sanity check: ${tableId} is queryable (${result.total} rows)`);
  }
}

setup()
  .then(() => console.log("\nDone! Investment Case schema setup complete."))
  .catch((e) => {
    console.error("\nSetup failed:", e);
    process.exit(1);
  });
