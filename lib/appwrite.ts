import { Client, Account } from "appwrite";
import {
  Client as ServerClient,
  Account as ServerAccount,
  Databases as ServerDatabases,
  TablesDB as ServerTablesDB,
  Users as ServerUsers,
  Storage as ServerStorage,
} from "node-appwrite";

// Client-side SDK (browser)
export const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

export const account = new Account(client);

// No browser `TablesDB` export on purpose. Table permissions are empty so that
// row access is impossible except through an API route holding an API key,
// which is where the `userId` ownership checks live. A client-side TablesDB
// would only ever be a way to route around them.
// See scripts/lock-table-permissions.ts.

// Server-side SDK (Node.js) - only for server components/routes
export const serverClient = new ServerClient()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);

export const serverAccount = new ServerAccount(serverClient);
export const serverDatabases = new ServerDatabases(serverClient);
export const serverTablesDB = new ServerTablesDB(serverClient);
export const serverUsers = new ServerUsers(serverClient);
export const serverStorage = new ServerStorage(serverClient);

// Constants for database
export const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
export const USERS_TABLE_ID = "users";
export const CANVASES_TABLE_ID = "canvases";
export const BLOCKS_TABLE_ID = "blocks";
export const MESSAGES_TABLE_ID = "messages";
export const SEGMENTS_TABLE_ID = "segments";
export const BLOCK_SEGMENTS_TABLE_ID = "block_segments";
export const ASSUMPTIONS_TABLE_ID = "assumptions";
export const EXPERIMENTS_TABLE_ID = "experiments";

// Investment Case module — see docs/INVESTMENT_CASE_SPEC.md
// NOTE: these tables must be created manually in the Appwrite console (same
// pattern as `experiments` and `ai_usage_events`) before the API routes work.
export const INVESTMENT_CASES_TABLE_ID = "investment_cases";
export const CASE_QUOTES_TABLE_ID = "case_quotes";
export const CASE_DEMAND_TESTS_TABLE_ID = "case_demand_tests";

// Storage bucket backing `case_quotes.attachmentFileId` and
// `case_demand_tests.evidenceFileId` (spec §4.4). Created by
// scripts/setup-case-attachments-bucket.ts. Like the tables, it carries no
// client-facing permissions — files are read back through
// GET /api/investment-cases/:id/attachments/:fileId, which checks that the file
// is actually referenced by that case before streaming it.
export const CASE_ATTACHMENTS_BUCKET_ID = "case_attachments";

// Backward-compatible aliases (legacy "collection" naming)
export const USERS_COLLECTION_ID = USERS_TABLE_ID;
export const CANVASES_COLLECTION_ID = CANVASES_TABLE_ID;
export const BLOCKS_COLLECTION_ID = BLOCKS_TABLE_ID;
export const MESSAGES_COLLECTION_ID = MESSAGES_TABLE_ID;
export const SEGMENTS_COLLECTION_ID = SEGMENTS_TABLE_ID;
export const BLOCK_SEGMENTS_COLLECTION_ID = BLOCK_SEGMENTS_TABLE_ID;
