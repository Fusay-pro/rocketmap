import { redirect } from "next/navigation";
import { Query } from "node-appwrite";
import { getSessionUser } from "@/lib/appwrite-server";
import {
  serverTablesDB,
  DATABASE_ID,
  CANVASES_TABLE_ID,
  BLOCKS_TABLE_ID,
  SEGMENTS_TABLE_ID,
} from "@/lib/appwrite";
import type {
  BlockData,
  BlockType,
  BlockContent,
  CanvasData,
  AIAnalysis,
  MarketResearchData,
  Segment,
  ViabilityData,
} from "@/lib/types/canvas";
import { BLOCK_DEFINITIONS } from "@/app/components/canvas/constants";
import { CanvasClient } from "./CanvasClient";
import { CanvasBackgroundIllustration } from "@/app/components/canvas/CanvasBackgroundIllustration";
import { getUserIdFromCanvasLike, listCanvasesByOwner } from "@/lib/utils";
import { normalizeViabilityData } from "@/lib/utils/viability";

interface PageProps {
  params: Promise<{ slug: string }>;
}

function parseContentJson(raw: string | undefined): BlockContent {
  if (!raw) return { bmc: "", lean: "", items: [] };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const record = isRecord(parsed) ? parsed : {};
    const atomicText = readString(record.text);
    const bmc = readString(record.bmc);
    const lean = readString(record.lean);
    const items = Array.isArray(record.items)
      ? (record.items as BlockContent["items"])
      : [];

    return {
      bmc: bmc || atomicText,
      lean: lean || atomicText,
      items,
    };
  } catch {
    return { bmc: String(raw), lean: "", items: [] };
  }
}

function parseAiAnalysis(raw: string | undefined): AIAnalysis | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      draft: parsed.draft ?? "",
      assumptions: parsed.assumptions ?? [],
      risks: parsed.risks ?? [],
      questions: parsed.questions ?? [],
      generatedAt: parsed.generatedAt ?? "",
    };
  } catch {
    return null;
  }
}

function parseDeepDiveJson(raw: string | undefined): MarketResearchData | null {
  if (!raw) return null;
  try {
    return (
      typeof raw === "string" ? JSON.parse(raw) : raw
    ) as MarketResearchData;
  } catch {
    return null;
  }
}

type SegmentRefValue = {
  $id?: unknown;
  name?: unknown;
  description?: unknown;
  earlyAdopterFlag?: unknown;
  priorityScore?: unknown;
  demographics?: unknown;
  psychographics?: unknown;
  behavioral?: unknown;
  geographic?: unknown;
  estimatedSize?: unknown;
  colorHex?: unknown;
};

type SegmentRef = string | SegmentRefValue;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function normalizeSegmentRef(
  segmentRef: SegmentRef,
  segmentById: Map<string, Segment>,
): Segment | null {
  if (!segmentRef) return null;

  const segmentId =
    typeof segmentRef === "string"
      ? segmentRef
      : isRecord(segmentRef) && typeof segmentRef.$id === "string"
        ? segmentRef.$id
        : null;

  if (!segmentId) return null;

  const fromLookup = segmentById.get(segmentId);
  if (fromLookup) return fromLookup;

  if (typeof segmentRef === "string") {
    return null;
  }

  if (typeof segmentRef !== "string" && isRecord(segmentRef) && segmentRef.$id) {
    const name =
      typeof segmentRef.name === "string" ? segmentRef.name : "";
    const description =
      typeof segmentRef.description === "string" ? segmentRef.description : "";
    const earlyAdopterFlag =
      typeof segmentRef.earlyAdopterFlag === "boolean"
        ? segmentRef.earlyAdopterFlag
        : false;
    const priorityScore =
      typeof segmentRef.priorityScore === "number"
        ? segmentRef.priorityScore
        : 50;
    const demographics =
      typeof segmentRef.demographics === "string" ? segmentRef.demographics : "";
    const psychographics =
      typeof segmentRef.psychographics === "string"
        ? segmentRef.psychographics
        : "";
    const behavioral =
      typeof segmentRef.behavioral === "string" ? segmentRef.behavioral : "";
    const geographic =
      typeof segmentRef.geographic === "string" ? segmentRef.geographic : "";
    const estimatedSize =
      typeof segmentRef.estimatedSize === "string" ? segmentRef.estimatedSize : "";
    const colorHex =
      typeof segmentRef.colorHex === "string" ? segmentRef.colorHex : undefined;

    return {
      $id: String(segmentRef.$id),
      name,
      description,
      earlyAdopterFlag,
      priorityScore,
      demographics,
      psychographics,
      behavioral,
      geographic,
      estimatedSize,
      colorHex,
    };
  }

  return null;
}

export default async function CanvasPage({ params }: PageProps) {
  const { slug } = await params;
  const user = await getSessionUser();
  let isReadOnly = true;

  const canvasSelect = [
    "$id",
    "title",
    "slug",
    "description",
    "isPublic",
    "viabilityDataJson",
    "viabilityCalculatedAt",
  ];

  let canvas: Record<string, unknown> | null = null;
  try {
    if (user) {
      const ownerResult = await listCanvasesByOwner(user.$id, [
        Query.equal("slug", slug),
        Query.select(canvasSelect),
        Query.limit(1),
      ]);

      if (ownerResult.rows.length > 0) {
        canvas = ownerResult.rows[0];
        isReadOnly = false;
      }
    }

    if (!canvas) {
      const publicResult = await serverTablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: CANVASES_TABLE_ID,
        queries: [
          Query.equal("isPublic", true),
          Query.equal("slug", slug),
          Query.select(canvasSelect),
          Query.limit(1),
        ],
      });

      if (publicResult.rows.length === 0) {
        redirect("/dashboard");
      }
      canvas = publicResult.rows[0];
    }
  } catch (error) {
    console.error("Error loading canvas:", error);
    redirect("/dashboard");
  }

  if (!canvas) {
    redirect("/dashboard");
  }

  // 2. Fetch blocks and segments for this canvas
  let blockDocs: Array<Record<string, unknown>> = [];
  let segmentDocs: Array<Record<string, unknown>> = [];

  try {
    // Index required: blocks.canvas (key), segments.canvas + priorityScore (composite, desc)
    const [blocksRes, segmentsRes] = await Promise.all([
      serverTablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: BLOCKS_TABLE_ID,
        queries: [
          Query.equal("canvas", canvas.$id as string),
          Query.select([
            "$id", "$createdAt", "blockType", "contentJson",
            "aiAnalysisJson", "confidenceScore", "riskScore",
            "deepDiveJson",
          ]),
          Query.limit(100),
        ],
      }),
      serverTablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: SEGMENTS_TABLE_ID,
        queries: [
          Query.equal("canvas", canvas.$id as string),
          Query.select([
            "$id", "name", "description", "earlyAdopterFlag",
            "priorityScore", "demographics", "psychographics",
            "behavioral", "geographic", "estimatedSize", "colorHex",
          ]),
          Query.orderDesc("priorityScore"),
          Query.limit(100),
        ],
      }),
    ]);
    blockDocs = blocksRes.rows;
    segmentDocs = segmentsRes.rows;

    // Debug: Log how many blocks we have
    console.log(
      `[Canvas ${canvas.$id as string}] Loaded ${blockDocs.length} blocks from database`,
    );
    if (blockDocs.length > 9) {
      console.log('Block types:', blockDocs.map(d => d.blockType));
    }
  } catch (error) {
    console.error("Error fetching canvas components:", error);
  }

  // 3. Map segments for easy lookup
  const initialSegments: Segment[] = segmentDocs.map((doc) => ({
    $id: readString(doc.$id),
    name: readString(doc.name),
    description: readString(doc.description),
    earlyAdopterFlag: readBoolean(doc.earlyAdopterFlag),
    priorityScore: readNumber(doc.priorityScore, 50),
    demographics: readString(doc.demographics),
    psychographics: readString(doc.psychographics),
    behavioral: readString(doc.behavioral),
    geographic: readString(doc.geographic),
    estimatedSize: readString(doc.estimatedSize),
    colorHex: readString(doc.colorHex) || undefined,
  }));

  const segmentById = new Map(
    initialSegments.map((segment) => [segment.$id, segment]),
  );

  // 4. Group blocks by blockType (handle multiple blocks per type)
  const blocksByType = new Map<string, Array<Record<string, unknown>>>();
  for (const doc of blockDocs) {
    const type = readString(doc.blockType);
    if (!blocksByType.has(type)) {
      blocksByType.set(type, []);
    }
    blocksByType.get(type)!.push(doc);
  }

  // 5. Build initial blocks, converting extra blocks to items
  const initialBlocks: BlockData[] = BLOCK_DEFINITIONS.map((def) => {
    const docsForType = blocksByType.get(def.type) || [];

    if (docsForType.length === 0) {
      // No blocks for this type, return empty
      return {
        blockType: def.type as BlockType,
        content: { bmc: "", lean: "", items: [] },
        state: "calm" as const,
        aiAnalysis: null,
        confidenceScore: 0,
        riskScore: 0,
        deepDiveData: null,
        linkedSegments: [],
      };
    }

    // Use first block as the "main" block
    const mainDoc = docsForType[0];
    const content = parseContentJson(readString(mainDoc?.contentJson));

    // Convert remaining blocks to items
    if (docsForType.length > 1) {
      console.log(`[${def.type}] Converting ${docsForType.length - 1} extra blocks to items`);

      const extraItems = docsForType.slice(1).map((doc, idx) => {
        const extraContent = parseContentJson(readString(doc.contentJson));
        // Use the bmc content as the item name
        const name = extraContent.bmc || extraContent.lean || `Item ${idx + 1}`;
        const description = extraContent.bmc !== extraContent.lean && extraContent.lean
          ? extraContent.lean
          : "";
        const linkedSegmentIds = Array.isArray(doc.segments)
          ? (doc.segments as SegmentRef[])
              .map((s) => normalizeSegmentRef(s, segmentById)?.$id)
              .filter((id): id is string => Boolean(id))
          : [];

        return {
          id: readString(doc.$id),
          name,
          description,
          linkedSegmentIds,
          tags: [],
          linkedItemIds: [],
          createdAt: readString(doc.$createdAt) || new Date().toISOString(),
        };
      });

      content.items = [...content.items, ...extraItems];
    }

    // Relationship attributes for segments
    const linkedSegments: Segment[] = Array.isArray(mainDoc?.segments)
      ? (mainDoc.segments as SegmentRef[]).map((s) =>
          normalizeSegmentRef(s, segmentById),
        )
          .filter((s): s is Segment => s !== null)
      : [];

    return {
      blockType: def.type as BlockType,
      content,
      state: "calm" as const,
      aiAnalysis: parseAiAnalysis(readString(mainDoc?.aiAnalysisJson)),
      confidenceScore: readNumber(mainDoc?.confidenceScore, 0),
      riskScore: readNumber(mainDoc?.riskScore, 0),
      deepDiveData: parseDeepDiveJson(readString(mainDoc?.deepDiveJson)),
      linkedSegments,
    };
  });

  // Parse viability data from canvas row
  let viabilityData: ViabilityData | null = null;
  const viabilityDataJsonRaw = readString(canvas.viabilityDataJson);
  if (viabilityDataJsonRaw) {
    try {
      viabilityData = normalizeViabilityData(
        JSON.parse(viabilityDataJsonRaw) as Partial<ViabilityData>,
      );
    } catch {
      // ignore parse errors
    }
  }

  const canvasData: CanvasData = {
    $id: canvas.$id as string,
    title: readString(canvas.title),
    slug: readString(canvas.slug),
    description: readString(canvas.description),
    isPublic: readBoolean(canvas.isPublic),
    user: getUserIdFromCanvasLike(canvas as Record<string, unknown>),
    viabilityData,
    viabilityCalculatedAt: readString(canvas.viabilityCalculatedAt) || null,
  };

  return (
    <div className="canvas-page-bg text-lg" style={{ backgroundColor: "var(--background)" }}>
      <CanvasBackgroundIllustration />
      <CanvasClient
        canvasId={canvas.$id as string}
        initialCanvasData={canvasData}
        initialBlocks={initialBlocks}
        initialSegments={initialSegments}
        readOnly={isReadOnly}
        initialViabilityData={canvasData.viabilityData}
      />
    </div>
  );
}
