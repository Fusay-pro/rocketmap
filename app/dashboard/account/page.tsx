import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/appwrite-server";
import {
  serverTablesDB,
  DATABASE_ID,
  BLOCKS_TABLE_ID,
} from "@/lib/appwrite";
import { Query } from "node-appwrite";
import { AccountClient } from "./AccountClient";
import { listCanvasesByOwner } from "@/lib/utils";

export default async function AccountPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/?error=unauthorized");
  }

  let canvasCount = 0;
  let totalBlocksFilled = 0;

  // Index required: canvases.user (key)
  // Index required: blocks.canvas (relationship — auto-indexed by Appwrite)
  try {
    const canvasesResult = await listCanvasesByOwner(user.$id, [
      Query.select(["$id"]),
      Query.limit(100),
    ]);
    canvasCount = canvasesResult.total;

    for (const canvas of canvasesResult.rows) {
      try {
        const blocksResult = await serverTablesDB.listRows({
          databaseId: DATABASE_ID,
          tableId: BLOCKS_TABLE_ID,
          queries: [
            Query.equal("canvas", canvas.$id),
            Query.select(["$id", "blockType", "contentJson"]),
            Query.limit(100),
          ],
        });
        // Dedupe by block type so this stat means the same thing as the
        // dashboard card's "N/9" — a canvas holds many atomic rows per type.
        const filledTypes = new Set<string>();
        for (const block of blocksResult.rows) {
          const content = block.contentJson as string;
          if (!content) continue;
          let hasContent: boolean;
          try {
            const parsed = JSON.parse(content);
            hasContent = Boolean(
              (parsed.bmc && parsed.bmc.trim() !== "") ||
                (parsed.lean && parsed.lean.trim() !== ""),
            );
          } catch {
            hasContent = content.trim() !== "";
          }
          if (hasContent) filledTypes.add(block.blockType as string);
        }
        totalBlocksFilled += filledTypes.size;
      } catch (error) {
        console.error(`[account] block fetch failed for canvas ${canvas.$id}:`, error);
      }
    }
  } catch {
    // Collections might not exist
  }

  const daysActive = Math.max(
    1,
    Math.floor((Date.now() - new Date(user.$createdAt).getTime()) / 86400000),
  );

  return (
    <AccountClient
      user={{
        name: user.name || "",
        email: user.email,
        joinDate: user.$createdAt,
      }}
      stats={{
        canvasCount,
        totalBlocksFilled,
        daysActive,
      }}
    />
  );
}
