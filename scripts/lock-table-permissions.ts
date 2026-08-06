/**
 * Strip client-facing permissions from every table in a database.
 *
 * Why: the tables were created with
 *   Permission.read/create/update/delete(Role.users())
 * and `rowSecurity: false`. `Role.users()` is *every authenticated account in
 * the Appwrite project*, and with row security off there is no per-row check
 * behind it. Because `NEXT_PUBLIC_APPWRITE_PROJECT_ID` and the endpoint are
 * public by construction, any signed-in user could open the client SDK against
 * this project and read, edit, or delete any other user's canvases, blocks,
 * assumptions, or investment cases — never touching the API routes where the
 * `userId` ownership checks live.
 *
 * The app does not need those grants. Every read/write goes through a Next.js
 * route that uses `serverTablesDB`, which authenticates with an API key, and an
 * API key bypasses table permissions entirely. `lib/appwrite.ts` does export a
 * browser `tablesDB`, but nothing imports it (verified) — the export has been
 * removed so it cannot be reintroduced by accident.
 *
 * Usage:
 *   # dry run (default) — prints what would change, writes nothing
 *   node --env-file=.env.local scripts/lock-table-permissions.ts
 *
 *   # apply, naming the database explicitly as confirmation
 *   CONFIRM_DB=rocketmap-dev node --env-file=.env.local scripts/lock-table-permissions.ts --apply
 *
 * Idempotent: tables already at zero permissions are reported and skipped.
 */
import { Client, TablesDB } from "node-appwrite";

const DB = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const APPLY = process.argv.includes("--apply");

async function main() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);
  const tablesDB = new TablesDB(client);

  console.log(`Target database: ${DB}`);
  console.log(APPLY ? "Mode: APPLY (will write)\n" : "Mode: DRY RUN (no writes)\n");

  if (APPLY && process.env.CONFIRM_DB !== DB) {
    throw new Error(
      `Refusing to write. Re-run with CONFIRM_DB="${DB}" to confirm you mean this database.`,
    );
  }

  const { tables } = await tablesDB.listTables({ databaseId: DB });
  if (tables.length === 0) {
    console.log("No tables found.");
    return;
  }

  let changed = 0;
  let alreadyLocked = 0;

  for (const table of tables) {
    const current = table.$permissions ?? [];
    if (current.length === 0) {
      console.log(`  ${table.$id.padEnd(20)} already server-only`);
      alreadyLocked++;
      continue;
    }

    console.log(`  ${table.$id.padEnd(20)} ${current.length} grant(s): ${current.join(", ")}`);
    // rowSecurity is left exactly as found. Toggling it changes how per-row
    // permissions are evaluated, and with the table-level grants gone there is
    // nothing left for it to widen.
    if (APPLY) {
      await tablesDB.updateTable({
        databaseId: DB,
        tableId: table.$id,
        name: table.name,
        permissions: [],
        rowSecurity: table.rowSecurity,
        enabled: table.enabled,
      });
      console.log(`  ${"".padEnd(20)} -> stripped`);
    }
    changed++;
  }

  console.log(
    `\n${tables.length} table(s): ${changed} ${APPLY ? "stripped" : "would be stripped"}, ` +
      `${alreadyLocked} already server-only`,
  );

  if (!APPLY && changed > 0) {
    console.log(`\nTo apply: CONFIRM_DB=${DB} node --env-file=.env.local scripts/lock-table-permissions.ts --apply`);
  }

  if (APPLY && changed > 0) {
    // Read back rather than trusting the write. Appwrite applies table metadata
    // updates immediately (unlike columns), so a stale read here means a real
    // failure, not a race.
    const after = await tablesDB.listTables({ databaseId: DB });
    const stillOpen = after.tables.filter((t) => (t.$permissions ?? []).length > 0);
    if (stillOpen.length > 0) {
      throw new Error(`Still permissive after write: ${stillOpen.map((t) => t.$id).join(", ")}`);
    }
    console.log("Verified: every table now has zero client-facing permissions.");
  }
}

main().catch((e) => {
  console.error("\nFailed:", e);
  process.exit(1);
});
