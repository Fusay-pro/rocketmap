import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/appwrite-server";
import {
  getAiKeyStatusForUser,
  removeAiApiKeyForUser,
  saveAiApiKeyForUser,
  migrateAiApiKeyIfPlaintext,
} from "@/lib/ai/user-preferences";
import { MissingEncryptionSecretError } from "@/lib/ai/key-encryption";

export async function GET() {
  try {
    const user = await requireAuth();
    // Opportunistic one-shot upgrade for keys saved before encryption existed.
    // No-op once the stored value is already ciphertext.
    void migrateAiApiKeyIfPlaintext(user);
    const status = await getAiKeyStatusForUser(user.$id);
    return NextResponse.json(status);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireAuth();
    const body = (await request.json()) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";

    if (!apiKey.trim()) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 },
      );
    }

    const { maskedKey } = await saveAiApiKeyForUser(user.$id, apiKey);
    return NextResponse.json({ hasKey: true, maskedKey });
  } catch (error: unknown) {
    // A missing encryption secret is a server misconfiguration, not bad input.
    // Surfaced explicitly so it reads as "the server can't store this safely"
    // rather than a generic failure that invites retrying the same key.
    if (error instanceof MissingEncryptionSecretError) {
      console.error("[ai-key]", error.message);
      return NextResponse.json(
        { error: "Server is not configured to store API keys securely. Contact the administrator." },
        { status: 503 },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    const status =
      message === "Unauthorized" ? 401 : message === "Invalid AI API key" ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE() {
  try {
    const user = await requireAuth();
    await removeAiApiKeyForUser(user.$id);
    return NextResponse.json({ hasKey: false, maskedKey: null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
