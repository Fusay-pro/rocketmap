# Appwrite TablesDB Migration Guide

**Last Updated:** February 2026
**Appwrite Version:** 1.8.x / node-appwrite v22.x

## ⚠️ CRITICAL: Use TablesDB API Only

The old `Databases` API is **deprecated**. All new code MUST use the `TablesDB` API.

**Official Documentation:** https://appwrite.io/docs/references/cloud/server-nodejs/tablesDB

---

## Quick Reference

### Import Changes

```typescript
// ❌ OLD (DEPRECATED)
import { Databases } from 'node-appwrite';
const databases = new Databases(client);

// ✅ NEW (CORRECT)
import { TablesDB } from 'node-appwrite';
const tablesDB = new TablesDB(client);
```

### Method Name Changes

| Old Method | New Method |
|------------|------------|
| `listDocuments` | `listRows` |
| `getDocument` | `getRow` |
| `createDocument` | `createRow` |
| `updateDocument` | `updateRow` |
| `deleteDocument` | `deleteRow` |

### Terminology Changes

| Old Term | New Term |
|----------|----------|
| Collection | Table |
| Document | Row |
| Attribute | Column |

---

## Complete API Migration

### 1. List Rows (Query Data)

```typescript
// ❌ OLD API (DEPRECATED)
const result = await databases.listDocuments(
  DATABASE_ID,
  COLLECTION_ID,
  [
    Query.equal('status', 'active'),
    Query.select(['name', 'email']),
    Query.limit(25),
  ]
);
const items = result.documents;

// ✅ NEW API (CORRECT)
const result = await tablesDB.listRows({
  databaseId: DATABASE_ID,
  tableId: TABLE_ID,
  queries: [
    Query.equal('status', 'active'),
    Query.select(['name', 'email']),
    Query.limit(25),
  ],
});
const items = result.rows; // ⚠️ Note: .rows not .documents
```

**Key Changes:**
- Positional parameters → Object parameters
- `result.documents` → `result.rows`
- Collection ID → Table ID

### 2. Get Single Row

```typescript
// ❌ OLD API (DEPRECATED)
const doc = await databases.getDocument(
  DATABASE_ID,
  COLLECTION_ID,
  documentId,
  [Query.select(['name', 'age'])]
);

// ✅ NEW API (CORRECT)
const row = await tablesDB.getRow({
  databaseId: DATABASE_ID,
  tableId: TABLE_ID,
  rowId: documentId,
  queries: [Query.select(['name', 'age'])],
});
```

### 3. Create Row

```typescript
// ❌ OLD API (DEPRECATED)
const doc = await databases.createDocument(
  DATABASE_ID,
  COLLECTION_ID,
  ID.unique(), // Manual ID generation
  { name: 'John', email: 'john@example.com' }
);

// ✅ NEW API (CORRECT)
const row = await tablesDB.createRow({
  databaseId: DATABASE_ID,
  tableId: TABLE_ID,
  rowId: ID.unique(), // ✅ Required
  data: { name: 'John', email: 'john@example.com' },
});
```

**Critical:** `createRow` **requires** a `rowId`. Pass `ID.unique()` to have Appwrite
generate one for you.

> **Correction (2026-08-05).** Earlier revisions of this document claimed the
> opposite — that `createRow` auto-generates the id and passing `rowId` errors.
> That is wrong for the installed `node-appwrite@22`, whose type declares
> `rowId: string` as a required member of the params object. Every `createRow`
> call in the codebase passes it and works. If you hit
> `Invalid parameter "rowId"`, the cause is a malformed id value, not the
> presence of the parameter.

### 4. Update Row

```typescript
// ❌ OLD API (DEPRECATED)
await databases.updateDocument(
  DATABASE_ID,
  COLLECTION_ID,
  documentId,
  { name: 'Jane' }
);

// ✅ NEW API (CORRECT)
await tablesDB.updateRow({
  databaseId: DATABASE_ID,
  tableId: TABLE_ID,
  rowId: documentId, // ✅ Required for updates
  data: { name: 'Jane' },
});
```

### 5. Delete Row

```typescript
// ❌ OLD API (DEPRECATED)
await databases.deleteDocument(
  DATABASE_ID,
  COLLECTION_ID,
  documentId
);

// ✅ NEW API (CORRECT)
await tablesDB.deleteRow({
  databaseId: DATABASE_ID,
  tableId: TABLE_ID,
  rowId: documentId,
});
```

---

## Common Pitfalls & Solutions

### ❌ Pitfall 1: Omitting rowId on createRow

```typescript
// ❌ WRONG - rowId is required
await tablesDB.createRow({
  databaseId: DATABASE_ID,
  tableId: TABLE_ID,
  data: { name: 'John' },
});

// ✅ CORRECT
await tablesDB.createRow({
  databaseId: DATABASE_ID,
  tableId: TABLE_ID,
  rowId: ID.unique(),
  data: { name: 'John' },
});
```

> This pitfall was previously written the other way round. See the correction
> under "Create Row" above.

### ❌ Pitfall 2: Using .documents instead of .rows

```typescript
// ❌ WRONG - Response structure changed
const result = await tablesDB.listRows({ databaseId, tableId });
const items = result.documents; // ❌ Property doesn't exist!

// ✅ CORRECT
const result = await tablesDB.listRows({ databaseId, tableId });
const items = result.rows; // ✅ Use .rows
```

### ❌ Pitfall 3: Selecting Relationship Fields

```typescript
// ❌ WRONG - Relationship fields cannot be in Query.select()
const result = await tablesDB.listRows({
  databaseId: DATABASE_ID,
  tableId: BLOCKS_TABLE_ID,
  queries: [
    Query.select(['$id', 'name', 'segments']), // ❌ 'segments' is a relationship!
  ],
});
// Error: "Cannot select attributes: segments"

// ✅ CORRECT - Relationship fields are auto-loaded
const result = await tablesDB.listRows({
  databaseId: DATABASE_ID,
  tableId: BLOCKS_TABLE_ID,
  queries: [
    Query.select(['$id', 'name']), // ✅ Only select data fields
    // 'segments' will be automatically loaded as a relationship
  ],
});
```

**Rule:** Only include actual data columns in `Query.select()`. Relationship fields are automatically loaded and cannot be explicitly selected.

### ❌ Pitfall 4: Using Positional Parameters

```typescript
// ❌ WRONG - Old positional parameter style
const result = await tablesDB.listRows(DATABASE_ID, TABLE_ID, [Query.limit(10)]);

// ✅ CORRECT - Object parameter style
const result = await tablesDB.listRows({
  databaseId: DATABASE_ID,
  tableId: TABLE_ID,
  queries: [Query.limit(10)],
});
```

---

## Project-Specific Constants

In our codebase, use these imports:

```typescript
import {
  serverTablesDB,      // ✅ Server-side TablesDB instance
  DATABASE_ID,         // ✅ Database ID constant
  CANVASES_TABLE_ID,   // ✅ Table ID constants (not COLLECTION)
  BLOCKS_TABLE_ID,
  SEGMENTS_TABLE_ID,
  MESSAGES_TABLE_ID,
  USERS_TABLE_ID,
} from '@/lib/appwrite';
```

---

## Migration Checklist

When writing new Appwrite code, ensure:

- [ ] Import `TablesDB` not `Databases`
- [ ] Use `serverTablesDB` instance (already configured in `lib/appwrite.ts`)
- [ ] Use `*_TABLE_ID` constants (not `*_COLLECTION_ID`)
- [ ] Use `listRows()` not `listDocuments()`
- [ ] Use `getRow()` not `getDocument()`
- [ ] Use `createRow()` not `createDocument()`
- [ ] Use `updateRow()` not `updateRow()`
- [ ] Use `deleteRow()` not `deleteDocument()`
- [ ] Pass parameters as objects: `{ databaseId, tableId, rowId, queries, data }`
- [ ] Access results via `.rows` not `.documents`
- [ ] DO pass `rowId` to `createRow()` — it is required; use `ID.unique()`
- [ ] Do NOT include relationship fields in `Query.select()`

---

## Additional Resources

- **Official TablesDB API Reference:** https://appwrite.io/docs/references/cloud/server-nodejs/tablesDB
- **Migration Announcement:** https://appwrite.io/changelog/entry/2025-08-26-2
- **Query Documentation:** https://appwrite.io/docs/products/databases/queries

---

## Questions?

If you encounter issues with Appwrite queries:

1. Check if you're using the correct API (TablesDB, not Databases)
2. Verify parameter format (object parameters, not positional)
3. Confirm response access (`.rows`, not `.documents`)
4. Ensure relationship fields are not in `Query.select()`

**This migration was completed:** February 16, 2026
**All 27 files in the codebase have been migrated to TablesDB v22.**
