import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/appwrite-server";
import {
  serverTablesDB,
  DATABASE_ID,
  USERS_TABLE_ID,
  BLOCKS_TABLE_ID,
} from "@/lib/appwrite";
import { Query } from "node-appwrite";
import { DashboardClient } from "./DashboardClient";
import { listCanvasesByOwner } from "@/lib/utils";
import { deriveQptpFromViability, type QptpCounts } from "@/lib/utils/evidence-counts";
import type { BlockType, ViabilityData } from "@/lib/types/canvas";

export default async function DashboardPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/?error=unauthorized");
  }

  // Fetch or create user document
  let userDoc;
  try {
    userDoc = await serverTablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: USERS_TABLE_ID,
      rowId: user.$id,
    });
  } catch {
    try {
      // Use the Appwrite Auth user ID as the row ID for easy lookups
      userDoc = await serverTablesDB.createRow({
        databaseId: DATABASE_ID,
        tableId: USERS_TABLE_ID,
        rowId: user.$id,
        data: {
          email: user.email,
          name: user.name || "",
          onboardingCompleted: false,
        },
      });
    } catch (error) {
      console.error("Error creating user document:", error);
      userDoc = { onboardingCompleted: false };
    }
  }

  // Fetch user's canvases with block details
  // Index required: canvases.user + $updatedAt (composite, desc)
  // Index required: blocks.canvas (relationship — auto-indexed by Appwrite)
  let canvases: {
    $id: string;
    title: string;
    slug: string;
    description: string;
    $updatedAt: string;
    $createdAt: string;
    isPublic: boolean;
    blocksCount: number;
    filledBlocks: BlockType[];
    qptp: QptpCounts | null;
  }[] = [];
  try {
    const canvasesResult = await listCanvasesByOwner(user.$id, [
      Query.orderDesc("$updatedAt"),
      Query.select([
        "$id",
        "title",
        "slug",
        "description",
        "$updatedAt",
        "$createdAt",
        "isPublic",
        "viabilityDataJson",
      ]),
      Query.limit(25),
    ]);

    canvases = await Promise.all(
      canvasesResult.rows.map(async (doc) => {
        // A canvas holds many atomic rows per block type (33-49 is typical), so
        // dedupe by type — the card shows how many of the 9 types are filled.
        const filledBlockTypes = new Set<BlockType>();
        try {
          const blocksResult = await serverTablesDB.listRows({
            databaseId: DATABASE_ID,
            tableId: BLOCKS_TABLE_ID,
            queries: [
              Query.equal("canvas", doc.$id),
              Query.select(["$id", "blockType", "contentJson"]),
              Query.limit(100),
            ],
          });
          for (const block of blocksResult.rows) {
            const content = block.contentJson as string;
            if (!content) continue;
            try {
              const parsed = JSON.parse(content);
              if (
                (parsed.bmc && parsed.bmc.trim() !== "") ||
                (parsed.lean && parsed.lean.trim() !== "")
              ) {
                filledBlockTypes.add(block.blockType as BlockType);
              }
            } catch {
              if (content.trim() !== "") {
                filledBlockTypes.add(block.blockType as BlockType);
              }
            }
          }
        } catch (error) {
          // Never swallow silently — a bare catch here hid the canvasId bug
          // (every card rendering 0/9) for the whole life of the feature.
          console.error(`[dashboard] block fetch failed for canvas ${doc.$id}:`, error);
        }
        const filledBlocks = Array.from(filledBlockTypes);
        const d = doc as Record<string, unknown>;
        // Q / PTP counts, or null when the payload predates factor arrays.
        // Null means render nothing — a 0Q / 0PTP would be invented.
        let qptp: QptpCounts | null = null;
        const viabilityDataJson = d.viabilityDataJson as string | undefined;
        if (viabilityDataJson) {
          try {
            qptp = deriveQptpFromViability(
              JSON.parse(viabilityDataJson) as Partial<ViabilityData>,
            );
          } catch {
            qptp = null;
          }
        }
        return {
          $id: doc.$id,
          title: d.title as string,
          slug: d.slug as string,
          description: (d.description as string) || "",
          $updatedAt: doc.$updatedAt,
          $createdAt: doc.$createdAt,
          isPublic: (d.isPublic as boolean) ?? false,
          blocksCount: filledBlocks.length,
          filledBlocks,
          qptp,
        };
      }),
    );
  } catch (error) {
    console.error("Error fetching canvases:", error);
  }

  return (
    <DashboardClient
      user={{
        $id: user.$id,
        email: user.email,
        name: user.name || "",
      }}
      onboardingCompleted={userDoc.onboardingCompleted || false}
      canvases={canvases}
    />
  );
}
