import { Client, Databases, IndexType } from 'node-appwrite';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;

/**
 * Server-only. Deliberately empty — see scripts/setup-investment-case-db.ts for
 * the full rationale.
 *
 * Short version: these collections are only ever touched by API routes using an
 * API key, and API keys bypass permissions. The previous `Role.users()` grants
 * gave every authenticated account in the project read/write on every canvas,
 * block, and message — enforceable only by the route layer, which the client
 * SDK can skip entirely. Ownership checks live in the routes; the database must
 * not offer a way around them.
 */
const SERVER_ONLY_PERMISSIONS: string[] = [];
const USERS_COLLECTION_ID = 'users';
const CANVASES_COLLECTION_ID = 'canvases';
const MESSAGES_COLLECTION_ID = 'messages';

async function setup() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);

  const databases = new Databases(client);

  console.log('Using database:', DATABASE_ID);

  // 1. Create users collection
  try {
    await databases.createCollection({
      databaseId: DATABASE_ID,
      collectionId: USERS_COLLECTION_ID,
      name: 'Users',
      permissions: SERVER_ONLY_PERMISSIONS,
    });
    console.log('Created collection: users');

    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: USERS_COLLECTION_ID,
      key: 'userId', size: 36, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: USERS_COLLECTION_ID,
      key: 'email', size: 320, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: USERS_COLLECTION_ID,
      key: 'name', size: 256, required: false, xdefault: '',
    });
    await databases.createBooleanAttribute({
      databaseId: DATABASE_ID, collectionId: USERS_COLLECTION_ID,
      key: 'onboardingCompleted', required: false, xdefault: false,
    });
    console.log('Created users attributes');

    // Wait for attributes to be ready
    await new Promise((r) => setTimeout(r, 2000));

    await databases.createIndex({
      databaseId: DATABASE_ID, collectionId: USERS_COLLECTION_ID,
      key: 'userId_idx', type: IndexType.Key, attributes: ['userId'],
    });
    console.log('Created users index');
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 409) {
      console.log('Users collection already exists, skipping...');
    } else {
      throw e;
    }
  }

  // 2. Create canvases collection
  try {
    await databases.createCollection({
      databaseId: DATABASE_ID,
      collectionId: CANVASES_COLLECTION_ID,
      name: 'Canvases',
      permissions: SERVER_ONLY_PERMISSIONS,
    });
    console.log('Created collection: canvases');

    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: CANVASES_COLLECTION_ID,
      key: 'userId', size: 36, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: CANVASES_COLLECTION_ID,
      key: 'title', size: 256, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: CANVASES_COLLECTION_ID,
      key: 'slug', size: 256, required: true,
    });
    console.log('Created canvases attributes');

    // Wait for attributes to be ready
    await new Promise((r) => setTimeout(r, 2000));

    await databases.createIndex({
      databaseId: DATABASE_ID, collectionId: CANVASES_COLLECTION_ID,
      key: 'userId_idx', type: IndexType.Key, attributes: ['userId'],
    });
    await databases.createIndex({
      databaseId: DATABASE_ID, collectionId: CANVASES_COLLECTION_ID,
      key: 'slug_idx', type: IndexType.Unique, attributes: ['slug'],
    });
    console.log('Created canvases indexes');
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 409) {
      console.log('Canvases collection already exists, skipping...');
    } else {
      throw e;
    }
  }

  // 3. Create messages collection (chat persistence)
  try {
    await databases.createCollection({
      databaseId: DATABASE_ID,
      collectionId: MESSAGES_COLLECTION_ID,
      name: 'Messages',
      permissions: SERVER_ONLY_PERMISSIONS,
    });
    console.log('Created collection: messages');

    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: MESSAGES_COLLECTION_ID,
      key: 'canvasId', size: 32, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: MESSAGES_COLLECTION_ID,
      key: 'chatKey', size: 64, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: MESSAGES_COLLECTION_ID,
      key: 'role', size: 16, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: MESSAGES_COLLECTION_ID,
      key: 'content', size: 100000, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: MESSAGES_COLLECTION_ID,
      key: 'messageId', size: 64, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: MESSAGES_COLLECTION_ID,
      key: 'createdAt', size: 30, required: true,
    });
    await databases.createStringAttribute({
      databaseId: DATABASE_ID, collectionId: MESSAGES_COLLECTION_ID,
      key: 'userId', size: 36, required: true,
    });
    console.log('Created messages attributes');

    // Wait for attributes to be ready
    await new Promise((r) => setTimeout(r, 2000));

    await databases.createIndex({
      databaseId: DATABASE_ID, collectionId: MESSAGES_COLLECTION_ID,
      key: 'canvas_chat_idx', type: IndexType.Key, attributes: ['canvasId', 'chatKey'],
    });
    await databases.createIndex({
      databaseId: DATABASE_ID, collectionId: MESSAGES_COLLECTION_ID,
      key: 'userId_idx', type: IndexType.Key, attributes: ['userId'],
    });
    console.log('Created messages indexes');
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 409) {
      console.log('Messages collection already exists, skipping...');
    } else {
      throw e;
    }
  }

  console.log('\nDone! Database setup complete.');
}

setup().catch(console.error);
