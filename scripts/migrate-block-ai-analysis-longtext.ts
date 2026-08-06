/**
 * Migrate `blocks.aiAnalysisJson` from varchar(1000) to longtext.
 *
 * Why: a real block analysis (draft + assumptions + risks + questions) far
 * exceeds 1000 chars, so `updateRow` threw and a fire-and-forget `.catch`
 * hid it. Result: 1 of 773 rows in the shared database has any analysis at
 * all, and that one is an empty 96-char shell.
 *
 * The dev database is created with longtext already (setup-dev-database.ts
 * applies it as an override), so this script exists for the SHARED database.
 *
 * Usage:
 *   # dry run (default) — reports what it would do, writes nothing
 *   node --env-file=.env.local scripts/migrate-block-ai-analysis-longtext.ts
 *
 *   # apply, naming the database explicitly as confirmation
 *   CONFIRM_DB=<databaseId> node --env-file=.env.local scripts/migrate-block-ai-analysis-longtext.ts --apply
 *
 * ⚠️ STOP THE DEV SERVER FIRST. Between the delete and create steps the column
 *    does not exist, and app/canvas/[slug]/page.tsx selects it while
 *    lib/ai/tools.ts writes it — both will throw during that window (seconds).
 *
 * ⚠️ CHECK WHICH DATABASE YOU ARE POINTED AT. The script prints it and requires
 *    confirmation via CONFIRM_DB before touching a database it wasn't told to.
 *
 * Idempotent: re-running after success is a no-op.
 */
import { Client, TablesDB, Query } from "node-appwrite";

const DB = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const TABLE = "blocks";
const COLUMN = "aiAnalysisJson";
const APPLY = process.argv.includes("--apply");

function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 404;
}

async function waitForColumnGone(tablesDB: TablesDB, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await tablesDB.getColumn({ databaseId: DB, tableId: TABLE, key: COLUMN });
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      if (isNotFound(e)) return;
      throw e;
    }
  }
  throw new Error("Timed out waiting for the old column to finish deleting");
}

async function waitForColumnAvailable(tablesDB: TablesDB, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const table = await tablesDB.getTable({ databaseId: DB, tableId: TABLE });
    const col = table.columns.find((c) => c.key === COLUMN);
    if (col && col.status === "available") return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for the new column to become available");
}

async function main() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);
  const tablesDB = new TablesDB(client);

  console.log(`Target database: ${DB}`);
  console.log(APPLY ? "Mode: APPLY (will drop and recreate the column)\n" : "Mode: DRY RUN (no writes)\n");

  // Two independent confirmations, matching lock-table-permissions.ts.
  //
  // This previously aborted only when CONFIRM_DB was present *and* wrong, which
  // meant the safest-looking invocation — running it with no extra env at all —
  // went straight to deleting a live column. A destructive default is exactly
  // backwards: the guard has to be something you opt into, not out of.
  if (APPLY && process.env.CONFIRM_DB !== DB) {
    throw new Error(
      `Refusing to modify "${DB}". Re-run with CONFIRM_DB="${DB}" to confirm you mean this database.`,
    );
  }

  // 1. Already migrated? Bail early. This is what makes re-runs safe — a
  //    partial run can leave the column deleted, which no conflict-swallowing
  //    helper would recover from.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const before = (await tablesDB.getColumn({ databaseId: DB, tableId: TABLE, key: COLUMN })) as any;
  console.log(`Current type: ${before.type}${before.size ? ` (size ${before.size})` : ""}`);
  if (before.type === "longtext") {
    console.log("Already migrated — nothing to do.");
    return;
  }

  // 2. Back up every non-empty value, paginating with a cursor.
  console.log("\nBacking up existing values...");
  const backup: Array<{ $id: string; value: string }> = [];
  let cursor: string | undefined;
  for (;;) {
    const queries = [Query.select(["$id", COLUMN]), Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await tablesDB.listRows({ databaseId: DB, tableId: TABLE, queries });
    if (page.rows.length === 0) break;
    for (const row of page.rows) {
      const value = row[COLUMN];
      if (typeof value === "string" && value.trim().length > 0) {
        backup.push({ $id: row.$id, value });
      }
    }
    cursor = page.rows[page.rows.length - 1].$id;
    if (page.rows.length < 100) break;
  }
  const bytes = backup.reduce((n, b) => n + b.value.length, 0);
  console.log(`  ${backup.length} row(s) hold a value, ${bytes} bytes total`);

  // A dry run stops here: everything above is read-only, everything below
  // destroys and rebuilds the column. This is the point of no return, so it is
  // also where the operator gets to see the blast radius before opting in.
  if (!APPLY) {
    console.log(
      `\nDRY RUN — would drop "${COLUMN}" (${before.type}${before.size ? ` ${before.size}` : ""}) ` +
        `and recreate it as longtext, restoring ${backup.length} value(s).`,
    );
    console.log(
      `\nTo apply (STOP THE DEV SERVER FIRST):\n` +
        `  CONFIRM_DB=${DB} node --env-file=.env.local scripts/migrate-block-ai-analysis-longtext.ts --apply`,
    );
    return;
  }

  // 3. Drop, wait for the delete to land, recreate as longtext.
  console.log("\nDeleting the varchar column...");
  await tablesDB.deleteColumn({ databaseId: DB, tableId: TABLE, key: COLUMN });
  await waitForColumnGone(tablesDB);
  console.log("  deleted");

  console.log("Creating it as longtext...");
  await tablesDB.createLongtextColumn({
    databaseId: DB,
    tableId: TABLE,
    key: COLUMN,
    required: false,
  });
  await waitForColumnAvailable(tablesDB);
  console.log("  created");

  // 4. Restore.
  if (backup.length > 0) {
    console.log("\nRestoring backed-up values...");
    for (const row of backup) {
      await tablesDB.updateRow({
        databaseId: DB,
        tableId: TABLE,
        rowId: row.$id,
        data: { [COLUMN]: row.value },
      });
    }
    console.log(`  restored ${backup.length} row(s)`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const after = (await tablesDB.getColumn({ databaseId: DB, tableId: TABLE, key: COLUMN })) as any;
  console.log(`\nFinal type: ${after.type}`);
  if (after.type !== "longtext") {
    throw new Error(`Expected longtext, got "${after.type}"`);
  }
}

main()
  .then(() => console.log("\nDone. Block analysis can now persist at full size."))
  .catch((e) => {
    console.error("\nMigration failed:", e);
    console.error(
      "\nIf the column was deleted but not recreated, re-run this script — it will " +
        "detect the missing column and fail fast, or you can recreate it manually as longtext.",
    );
    process.exit(1);
  });
