/**
 * Create a local dev database that mirrors the shared one, so development
 * never touches other users' data.
 *
 * The shared Appwrite project holds 9 users and 28 canvases across 7 owners.
 * This script stands up a SEPARATE database in the SAME project — auth is
 * project-level, so you stay logged in — and mirrors the schema into it.
 *
 * Usage:
 *   node --env-file=.env.local scripts/setup-dev-database.ts
 *
 * Then set NEXT_PUBLIC_APPWRITE_DATABASE_ID=rocketmap-dev in .env.local and
 * restart the dev server. Switch the ID back at any time to see the shared data.
 *
 * READ-ONLY against the source database. Idempotent: safe to re-run.
 *
 * NOTE: `Databases.create` is used only for the database itself — database-level
 * operations do NOT exist on TablesDB. Everything below the database (tables,
 * columns, rows) correctly uses TablesDB per the project's API rule.
 */
import {
  Client,
  Databases,
  TablesDB,
  IndexType,
  RelationshipType,
  RelationMutate,
} from "node-appwrite";
import type { Models } from "node-appwrite";

const SOURCE_DB = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const DEV_DB = process.env.DEV_DATABASE_ID ?? "rocketmap-dev";

/** `block_segments` is a legacy constant with no table behind it — excluded. */
const TABLES = [
  "users",
  "canvases",
  "blocks",
  "messages",
  "segments",
  "assumptions",
  "experiments",
  "ai_usage_events",
  "investment_cases",
  "case_quotes",
  "case_demand_tests",
];

/**
 * Columns to create differently in the dev DB than the source.
 * `blocks.aiAnalysisJson` is varchar(1000) in the shared DB, which silently
 * truncates every real block analysis (see docs/BACKEND_SPEC.md). The dev DB
 * is born correct; the shared DB is fixed by the separate migration script.
 */
const OVERRIDES: Record<string, { type: "longtext" }> = {
  "blocks.aiAnalysisJson": { type: "longtext" },
};

// Appwrite echoes the type's full numeric range when no bound was set.
// Passing those back on create is rejected, so treat them as "unset".
const INT_SENTINELS = new Set([
  String(-9223372036854775808),
  String(9223372036854775807),
]);
function meaningfulBound(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (Math.abs(v) === Number.MAX_VALUE) return undefined;
  if (INT_SENTINELS.has(String(v))) return undefined;
  return v;
}

function isConflict(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 409;
}

async function ignoreConflict(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`    + ${label}`);
  } catch (e) {
    if (isConflict(e)) {
      console.log(`    = ${label} (exists)`);
    } else {
      console.error(`    ! ${label}`);
      throw e;
    }
  }
}

async function waitForColumns(tablesDB: TablesDB, tableId: string, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const table = await tablesDB.getTable({ databaseId: DEV_DB, tableId });
    const pending = table.columns.filter((c) => c.status !== "available");
    if (pending.length === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for columns on "${tableId}"`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyColumn = any;

/** Non-relationship column. Enums arrive as type "string" carrying `elements`. */
function createScalarColumn(tablesDB: TablesDB, tableId: string, col: AnyColumn) {
  const key = col.key as string;
  const required = Boolean(col.required);
  // Appwrite rejects a default on a required column.
  const xdefault = !required && col.default !== null && col.default !== undefined ? col.default : undefined;
  const base = { databaseId: DEV_DB, tableId, key, required, array: Boolean(col.array) };

  const override = OVERRIDES[`${tableId}.${key}`];
  const type: string = override?.type ?? col.type;

  if (Array.isArray(col.elements) && col.elements.length > 0) {
    return tablesDB.createEnumColumn({ ...base, elements: col.elements, xdefault });
  }

  switch (type) {
    case "varchar":
      return tablesDB.createVarcharColumn({ ...base, size: col.size ?? 255, xdefault });
    case "string":
      return tablesDB.createStringColumn({ ...base, size: col.size ?? 255, xdefault });
    case "text":
      return tablesDB.createTextColumn({ ...base, xdefault });
    case "mediumtext":
      return tablesDB.createMediumtextColumn({ ...base, xdefault });
    case "longtext":
      return tablesDB.createLongtextColumn({ ...base, xdefault });
    case "boolean":
      return tablesDB.createBooleanColumn({ ...base, xdefault });
    case "integer":
      return tablesDB.createIntegerColumn({
        ...base,
        min: meaningfulBound(col.min),
        max: meaningfulBound(col.max),
        xdefault,
      });
    case "double":
      return tablesDB.createFloatColumn({
        ...base,
        min: meaningfulBound(col.min),
        max: meaningfulBound(col.max),
        xdefault,
      });
    case "datetime":
      return tablesDB.createDatetimeColumn({ ...base, xdefault });
    case "email":
      return tablesDB.createEmailColumn({ ...base, xdefault });
    case "url":
      return tablesDB.createUrlColumn({ ...base, xdefault });
    case "ip":
      return tablesDB.createIpColumn({ ...base, xdefault });
    default:
      throw new Error(`Unhandled column type "${type}" on ${tableId}.${key}`);
  }
}

async function main() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);

  const databases = new Databases(client);
  const tablesDB = new TablesDB(client);

  if (SOURCE_DB === DEV_DB) {
    throw new Error(`Refusing to run: source and dev database are both "${DEV_DB}".`);
  }

  console.log(`Mirroring schema: ${SOURCE_DB} (read-only)  ->  ${DEV_DB}\n`);

  await ignoreConflict(`database ${DEV_DB}`, () =>
    databases.create({ databaseId: DEV_DB, name: "RocketMap Dev" }),
  );

  // Read the whole source schema up front so the source is touched read-only
  // and only once.
  const source: Array<{ id: string; table: Models.Table }> = [];
  for (const id of TABLES) {
    try {
      source.push({ id, table: await tablesDB.getTable({ databaseId: SOURCE_DB, tableId: id }) });
    } catch {
      console.log(`  (source has no "${id}" — skipping)`);
    }
  }

  // Pass 1 — tables. All must exist before any relationship is created.
  console.log("\n[1/4] Tables");
  for (const { id, table } of source) {
    await ignoreConflict(id, () =>
      tablesDB.createTable({
        databaseId: DEV_DB,
        tableId: id,
        name: table.name,
        // NOT mirrored from the source table. The shared database's tables were
        // created with `Role.users()` on read/create/update/delete, which grants
        // every authenticated account in the project access to every row via the
        // client SDK. Copying that would reproduce the hole in the dev database.
        // These tables are reached only through API routes holding an API key,
        // and API keys bypass permissions — so empty is both safe and sufficient.
        // See scripts/lock-table-permissions.ts for the live remediation.
        permissions: [],
        rowSecurity: table.rowSecurity ?? false,
        enabled: table.enabled ?? true,
      }),
    );
  }

  // Pass 2 — scalar columns.
  console.log("\n[2/4] Columns");
  for (const { id, table } of source) {
    console.log(`  ${id}`);
    for (const col of table.columns as AnyColumn[]) {
      if (col.type === "relationship") continue;
      const note = OVERRIDES[`${id}.${col.key}`] ? ` (override -> ${OVERRIDES[`${id}.${col.key}`].type})` : "";
      await ignoreConflict(`${col.key}: ${col.type}${note}`, () =>
        createScalarColumn(tablesDB, id, col),
      );
    }
  }
  for (const { id } of source) await waitForColumns(tablesDB, id);

  // Pass 3 — relationships, from the parent side only. Appwrite creates the
  // child-side column automatically via twoWayKey; creating both sides 409s.
  console.log("\n[3/4] Relationships (parent side only)");
  for (const { id, table } of source) {
    for (const col of table.columns as AnyColumn[]) {
      if (col.type !== "relationship") continue;
      if (col.side !== "parent") continue;
      await ignoreConflict(`${id}.${col.key} -> ${col.relatedTable} (${col.relationType})`, () =>
        tablesDB.createRelationshipColumn({
          databaseId: DEV_DB,
          tableId: id,
          relatedTableId: col.relatedTable,
          type: col.relationType as RelationshipType,
          twoWay: Boolean(col.twoWay),
          key: col.key,
          twoWayKey: col.twoWayKey,
          onDelete: col.onDelete as RelationMutate,
        }),
      );
    }
  }
  for (const { id } of source) await waitForColumns(tablesDB, id);

  // Pass 4 — indexes. Relationship columns are auto-indexed and an explicit
  // index on one is rejected with column_type_invalid.
  console.log("\n[4/4] Indexes");
  for (const { id, table } of source) {
    const relKeys = new Set(
      (table.columns as AnyColumn[]).filter((c) => c.type === "relationship").map((c) => c.key),
    );
    for (const ix of ((table.indexes ?? []) as AnyColumn[])) {
      const cols: string[] = ix.columns ?? ix.attributes ?? [];
      if (cols.length === 0) {
        console.log(`    ? ${id}.${ix.key} has no columns — skipping`);
        continue;
      }
      if (cols.some((c) => relKeys.has(c))) {
        console.log(`    - ${id}.${ix.key} (relationship column, auto-indexed)`);
        continue;
      }
      await ignoreConflict(`${id}.${ix.key} [${cols.join(", ")}]`, () =>
        tablesDB.createIndex({
          databaseId: DEV_DB,
          tableId: id,
          key: ix.key,
          type: (ix.type as IndexType) ?? IndexType.Key,
          columns: cols,
          ...(Array.isArray(ix.orders) && ix.orders.length ? { orders: ix.orders } : {}),
        }),
      );
    }
  }

  // Verify parity.
  console.log("\nVerification");
  let mismatches = 0;
  for (const { id, table } of source) {
    const dev = await tablesDB.getTable({ databaseId: DEV_DB, tableId: id });
    const srcKeys = new Set((table.columns as AnyColumn[]).map((c) => c.key));
    const devKeys = new Set((dev.columns as AnyColumn[]).map((c) => c.key));
    const missing = [...srcKeys].filter((k) => !devKeys.has(k));
    const notAvailable = (dev.columns as AnyColumn[]).filter((c) => c.status !== "available");
    const flag = missing.length || notAvailable.length ? "FAIL" : "ok";
    if (flag === "FAIL") mismatches++;
    console.log(
      `  ${flag.padEnd(4)} ${id}: ${devKeys.size}/${srcKeys.size} columns` +
        (missing.length ? ` | missing: ${missing.join(", ")}` : "") +
        (notAvailable.length ? ` | not available: ${notAvailable.map((c) => c.key).join(", ")}` : ""),
    );
  }

  const aiCol = (await tablesDB.getTable({ databaseId: DEV_DB, tableId: "blocks" }))
    .columns.find((c) => c.key === "aiAnalysisJson") as AnyColumn;
  console.log(`\n  blocks.aiAnalysisJson => ${aiCol?.type} (expected longtext)`);

  if (mismatches > 0) throw new Error(`${mismatches} table(s) did not mirror cleanly`);
}

main()
  .then(() =>
    console.log(
      `\nDone. Set NEXT_PUBLIC_APPWRITE_DATABASE_ID=${DEV_DB} in .env.local and restart the dev server.`,
    ),
  )
  .catch((e) => {
    console.error("\nSetup failed:", e);
    process.exit(1);
  });
