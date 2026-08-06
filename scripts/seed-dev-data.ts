/**
 * Seed the dev database with canvases shaped to exercise every rendering branch.
 *
 * A fresh database is useless for verification if it's empty — each canvas here
 * exists to prove one specific code path:
 *
 *   Seed — Full        all 9 block types, ~40 atomic rows  -> N/9 count, dedupe,
 *                                                             limit(100), preview
 *   Seed — Q·PTP       new-shape viability with factors     -> badge renders NQ · NPTP
 *   Seed — Breakdown   assumptions across all 4 categories  -> category breakdown
 *   Seed — Legacy      old-shape viability, no factors      -> renders NOTHING (the
 *                                                             27-canvas case)
 *   Seed — Empty       no blocks, no viability              -> zero state
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-dev-data.ts
 *
 * Refuses to run against anything but the dev database. Idempotent: deletes and
 * recreates only canvases whose title starts with "Seed — " AND that belong to
 * SEED_USER_ID. Never touches rows it didn't create.
 */
import { Client, TablesDB, Users, ID, Query } from "node-appwrite";

const DB = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const DEV_DB = process.env.DEV_DATABASE_ID ?? "rocketmap-dev";
const SEED_USER_ID = process.env.SEED_USER_ID ?? "6a27eb3d8315edf9efed"; // apivit37463@gmail.com
const TITLE_PREFIX = "Seed — ";

const BMC_BLOCKS = [
  "key_partnerships",
  "key_activities",
  "key_resources",
  "value_prop",
  "customer_relationships",
  "channels",
  "customer_segments",
  "cost_structure",
  "revenue_streams",
] as const;

/** Main content per block, then extra atomic item rows (the real schema shape). */
const CONTENT: Record<string, { main: string; items: string[] }> = {
  key_partnerships: {
    main: "Local rice mills and packaging suppliers in Nakhon Pathom",
    items: ["Grab/LINE MAN for delivery", "Kasikorn SME lending desk", "Two co-packing facilities"],
  },
  key_activities: {
    main: "Sourcing, small-batch roasting, and same-week fulfilment",
    items: ["Weekly supplier QC visits", "Content for TikTok Shop", "Wholesale account management"],
  },
  key_resources: {
    main: "Roasting equipment, supplier relationships, and the recipe library",
    items: ["Food-grade production licence", "In-house photography kit", "Customer list (3,200)"],
  },
  value_prop: {
    main: "Single-origin Thai snacks with traceable sourcing, delivered within a week of roasting",
    items: ["Freshness date on every pack", "No MSG, no palm oil", "Refill pouches at 30% less"],
  },
  customer_relationships: {
    main: "Direct LINE OA support plus a subscriber community",
    items: ["Monthly tasting livestream", "Auto-reorder reminders", "Wholesale account manager"],
  },
  channels: {
    main: "TikTok Shop, LINE MyShop, and 12 independent grocers",
    items: ["Weekend markets in Bangkok", "Shopee storefront", "Direct wholesale outreach"],
  },
  customer_segments: {
    main: "Urban Thai professionals 25-40 buying premium snacks for home and gifting",
    items: ["Corporate gifting buyers", "Independent grocery owners", "Expat specialty shoppers"],
  },
  cost_structure: {
    main: "Raw materials 42%, packaging 11%, logistics 14%, ads 18%",
    items: ["Co-packing retainer ฿45k/mo", "Two part-time production staff", "TikTok ad spend"],
  },
  revenue_streams: {
    main: "DTC packs at ฿320, subscription at ฿890/mo, wholesale at 55% of retail",
    items: ["Corporate gift boxes", "Refill subscriptions", "Wholesale pallets"],
  },
};

function blockRow(canvasId: string, blockType: string, text: string) {
  return {
    canvas: canvasId,
    blockType,
    contentJson: JSON.stringify({ bmc: text, lean: text, items: [] }),
  };
}

const ASSUMPTIONS: Array<{ text: string; category: string; status: string; risk: string; severity: number }> = [
  { text: "Urban professionals will pay ฿320 for a 200g premium snack pack", category: "market", status: "untested", risk: "high", severity: 9 },
  { text: "The gifting segment is large enough to absorb 30% of output in Q4", category: "market", status: "untested", risk: "high", severity: 8 },
  { text: "TikTok Shop CAC stays under ฿120 at 5x current spend", category: "market", status: "testing", risk: "high", severity: 8 },
  { text: "Independent grocers will reorder monthly without a rep visit", category: "market", status: "untested", risk: "medium", severity: 6 },
  { text: "Subscribers stay at least 5 months on average", category: "market", status: "untested", risk: "high", severity: 8 },
  { text: "Expat shoppers discover us through specialty grocers, not ads", category: "market", status: "untested", risk: "low", severity: 3 },
  { text: "Co-packers can scale to 4x volume without a new facility", category: "ops", status: "untested", risk: "high", severity: 8 },
  { text: "Same-week fulfilment holds through Songkran and year-end peaks", category: "ops", status: "testing", risk: "medium", severity: 6 },
  { text: "Two part-time staff cover production up to 3,000 packs/month", category: "ops", status: "untested", risk: "medium", severity: 5 },
  { text: "Suppliers hold pricing for a full 6-month term", category: "ops", status: "untested", risk: "medium", severity: 6 },
  { text: "Logistics stays at 14% of revenue as order volume grows", category: "ops", status: "untested", risk: "medium", severity: 5 },
  { text: "Freshness-dating is the feature that actually drives repeat purchase", category: "product", status: "untested", risk: "high", severity: 8 },
  { text: "Refill pouches don't cannibalise full-price pack sales", category: "product", status: "untested", risk: "medium", severity: 6 },
  { text: "Customers can taste the difference vs. mass-market competitors", category: "product", status: "untested", risk: "high", severity: 7 },
  { text: "Shelf life reaches 9 months without preservatives", category: "product", status: "testing", risk: "medium", severity: 6 },
  { text: "Our food-production licence covers the planned export SKUs", category: "legal", status: "untested", risk: "high", severity: 8 },
  { text: "Sourcing claims meet Thai FDA labelling rules for 'single-origin'", category: "legal", status: "untested", risk: "medium", severity: 6 },
  { text: "No trademark conflict on the brand name in TH and SG", category: "legal", status: "untested", risk: "low", severity: 4 },
];

const VIABILITY_NEW_SHAPE = {
  score: 34,
  potentialScore: 61,
  breakdown: { assumptions: 30, market: 42, unmetNeed: 31 },
  reasoning: "Real product and real early demand, but pricing and retention are still unproven.",
  verdict:
    "There is a genuine product and early organic pull, but the two numbers the whole model rests on — willingness to pay ฿320 and 5-month retention — have never been tested. Everything else is downstream of those.",
  factorsUp: [
    "Repeat purchase rate of 31% is already above category benchmark",
    "Supplier relationships are direct, which protects margin",
    "Freshness-dating is a real differentiator competitors can't copy quickly",
  ],
  factorsDown: [
    "Price point is 2.4x mass-market with no willingness-to-pay evidence",
    "Retention assumption of 5 months has no cohort data behind it",
    "CAC is measured at low spend and will almost certainly rise",
    "Co-packer capacity is a hard ceiling nobody has stress-tested",
  ],
  ceiling: "If retention holds at 5 months, this supports a ฿30-40M/yr business without new capital.",
  whatAbout:
    "What happens to the whole model if willingness to pay lands at ฿240 instead of ฿320 — does anything survive at that price?",
  unlockSteps: [],
  validatedAssumptions: [],
  calculatedAt: new Date().toISOString(),
};

/** Pre-factors payload — the shape 11 of 28 real canvases still carry. */
const VIABILITY_LEGACY_SHAPE = {
  score: 41,
  breakdown: { assumptions: 38, market: 45, unmetNeed: 40 },
  reasoning: "Older viability payload with no factor arrays — must render no badge at all.",
  validatedAssumptions: [],
  calculatedAt: new Date().toISOString(),
};

async function main() {
  if (DB !== DEV_DB) {
    throw new Error(
      `Refusing to seed: NEXT_PUBLIC_APPWRITE_DATABASE_ID is "${DB}", not "${DEV_DB}".\n` +
        `Point .env.local at the dev database first — this script must never write to the shared one.`,
    );
  }

  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);
  const db = new TablesDB(client);
  const users = new Users(client);

  console.log(`Seeding ${DB} for user ${SEED_USER_ID}\n`);

  // The canvases.user relationship is onDelete=restrict, so the user row must exist.
  const authUser = await users.get({ userId: SEED_USER_ID });
  try {
    await db.createRow({
      databaseId: DB,
      tableId: "users",
      rowId: SEED_USER_ID,
      data: { email: authUser.email, name: authUser.name || "", onboardingCompleted: true },
    });
    console.log(`  + users row for ${authUser.email}`);
  } catch {
    // Already there — still force onboardingCompleted so the welcome modal
    // doesn't cover the dashboard on every fresh dev database.
    await db.updateRow({
      databaseId: DB,
      tableId: "users",
      rowId: SEED_USER_ID,
      data: { onboardingCompleted: true },
    });
    console.log(`  = users row for ${authUser.email} (exists, onboarding marked complete)`);
  }

  // Idempotency: remove only our own seed canvases. Cascade takes the children.
  const existing = await db.listRows({
    databaseId: DB,
    tableId: "canvases",
    queries: [Query.startsWith("title", TITLE_PREFIX), Query.limit(100)],
  });
  for (const row of existing.rows) {
    const owner = typeof row.user === "string" ? row.user : (row.user as { $id?: string })?.$id;
    if (owner !== SEED_USER_ID) {
      console.log(`  ! skipping "${row.title}" — not owned by the seed user`);
      continue;
    }
    await db.deleteRow({ databaseId: DB, tableId: "canvases", rowId: row.$id });
    console.log(`  - removed old "${row.title}"`);
  }

  const now = new Date().toISOString();
  async function createCanvas(title: string, slug: string, extra: Record<string, unknown> = {}) {
    const row = await db.createRow({
      databaseId: DB,
      tableId: "canvases",
      rowId: ID.unique(),
      data: {
        title,
        slug,
        description: "",
        isPublic: false,
        createdAt: now,
        updatedAt: now,
        user: SEED_USER_ID,
        ...extra,
      },
    });
    return row.$id;
  }

  async function fillAllBlocks(canvasId: string, withItems: boolean) {
    let count = 0;
    for (const blockType of BMC_BLOCKS) {
      const c = CONTENT[blockType];
      await db.createRow({
        databaseId: DB,
        tableId: "blocks",
        rowId: ID.unique(),
        data: blockRow(canvasId, blockType, c.main),
      });
      count++;
      if (withItems) {
        for (const item of c.items) {
          await db.createRow({
            databaseId: DB,
            tableId: "blocks",
            rowId: ID.unique(),
            data: blockRow(canvasId, blockType, item),
          });
          count++;
        }
      }
    }
    return count;
  }

  // 1. Full — many atomic rows per block type
  const fullId = await createCanvas(`${TITLE_PREFIX}Full`, "seed-full");
  const fullBlocks = await fillAllBlocks(fullId, true);
  console.log(`\n  + "${TITLE_PREFIX}Full" — ${fullBlocks} block rows across 9 types`);

  // 2. Q·PTP — new-shape viability with factors
  const qptpId = await createCanvas(`${TITLE_PREFIX}Q·PTP`, "seed-q-ptp", {
    viabilityScore: VIABILITY_NEW_SHAPE.score,
    viabilityDataJson: JSON.stringify(VIABILITY_NEW_SHAPE),
    viabilityCalculatedAt: now,
  });
  await fillAllBlocks(qptpId, false);
  console.log(
    `  + "${TITLE_PREFIX}Q·PTP" — 9 blocks + viability ` +
      `(${VIABILITY_NEW_SHAPE.factorsDown.length} factorsDown, ${VIABILITY_NEW_SHAPE.factorsUp.length} factorsUp, whatAbout) ` +
      `-> expect 1Q · 4PTP`,
  );

  // 3. Breakdown — assumptions across all four categories
  const breakdownId = await createCanvas(`${TITLE_PREFIX}Breakdown`, "seed-breakdown");
  await fillAllBlocks(breakdownId, false);
  const byCat: Record<string, number> = {};
  for (const a of ASSUMPTIONS) {
    await db.createRow({
      databaseId: DB,
      tableId: "assumptions",
      rowId: ID.unique(),
      data: {
        canvas: breakdownId,
        assumptionText: a.text,
        category: a.category,
        status: a.status,
        riskLevel: a.risk,
        severityScore: a.severity,
        confidenceScore: 0,
        source: "ai",
        segmentIds: JSON.stringify([]),
        linkedValidationItemIds: JSON.stringify([]),
      },
    });
    byCat[a.category] = (byCat[a.category] ?? 0) + 1;
  }
  console.log(
    `  + "${TITLE_PREFIX}Breakdown" — 9 blocks + ${ASSUMPTIONS.length} assumptions ` +
      `(${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(", ")}) -> expect category breakdown, no badge`,
  );

  // 3b. Both — viability AND assumptions. The category breakdown lives inside
  // the Evidence popover, which only renders when viability data exists, so a
  // canvas with both is the only way to actually see the breakdown.
  const bothId = await createCanvas(`${TITLE_PREFIX}Both`, "seed-both", {
    viabilityScore: VIABILITY_NEW_SHAPE.score,
    viabilityDataJson: JSON.stringify(VIABILITY_NEW_SHAPE),
    viabilityCalculatedAt: now,
  });
  await fillAllBlocks(bothId, false);
  for (const a of ASSUMPTIONS) {
    await db.createRow({
      databaseId: DB,
      tableId: "assumptions",
      rowId: ID.unique(),
      data: {
        canvas: bothId,
        assumptionText: a.text,
        category: a.category,
        status: a.status,
        riskLevel: a.risk,
        severityScore: a.severity,
        confidenceScore: 0,
        source: "ai",
        segmentIds: JSON.stringify([]),
        linkedValidationItemIds: JSON.stringify([]),
      },
    });
  }
  console.log(
    `  + "${TITLE_PREFIX}Both" — 9 blocks + viability + ${ASSUMPTIONS.length} assumptions ` +
      `-> expect 1Q · 4PTP badge AND the category breakdown in its popover`,
  );

  // 4. Legacy — old viability payload, no factor arrays
  const legacyId = await createCanvas(`${TITLE_PREFIX}Legacy`, "seed-legacy", {
    viabilityScore: VIABILITY_LEGACY_SHAPE.score,
    viabilityDataJson: JSON.stringify(VIABILITY_LEGACY_SHAPE),
    viabilityCalculatedAt: now,
  });
  await fillAllBlocks(legacyId, false);
  console.log(`  + "${TITLE_PREFIX}Legacy" — 9 blocks + legacy viability -> expect NO count pair`);

  // 5. Empty
  await createCanvas(`${TITLE_PREFIX}Empty`, "seed-empty");
  console.log(`  + "${TITLE_PREFIX}Empty" — no blocks -> expect 0/9, no badge`);
}

main()
  .then(() => console.log("\nDone. Reload /dashboard to see the seed canvases."))
  .catch((e) => {
    console.error("\nSeed failed:", e);
    process.exit(1);
  });
