import type { Models } from "node-appwrite";
import { serverUsers } from "@/lib/appwrite";
import { decryptApiKey, encryptApiKey, isEncrypted } from "@/lib/ai/key-encryption";
import type { AIUsageInfo } from "@/lib/ai/logger";

// New neutral pref keys (provider-agnostic)
const PREF_AI_API_KEY = "aiApiKey";
const PREF_AI_USAGE_COUNT = "aiUsageCount";
const PREF_AI_INPUT_TOKENS = "aiInputTokens";
const PREF_AI_OUTPUT_TOKENS = "aiOutputTokens";
const PREF_AI_TOTAL_TOKENS = "aiTotalTokens";
const PREF_AI_LAST_USED_AT = "aiLastUsedAt";

// Legacy Anthropic pref keys (for backward-compatible reads)
const PREF_ANTHROPIC_API_KEY = "anthropicApiKey";
const PREF_ANTHROPIC_USAGE_COUNT = "anthropicUsageCount";
const PREF_ANTHROPIC_INPUT_TOKENS = "anthropicInputTokens";
const PREF_ANTHROPIC_OUTPUT_TOKENS = "anthropicOutputTokens";
const PREF_ANTHROPIC_TOTAL_TOKENS = "anthropicTotalTokens";
const PREF_ANTHROPIC_LAST_USED_AT = "anthropicLastUsedAt";

type PreferenceMap = Record<string, unknown>;

function normalizePreferences(
  prefs: Models.Preferences | PreferenceMap | null | undefined,
): PreferenceMap {
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
    return {};
  }

  return { ...(prefs as PreferenceMap) };
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return 0;
}

/**
 * The usable key: decrypted if stored encrypted, passed through if it predates
 * encryption. Returns null when a ciphertext won't authenticate, so a stale
 * secret degrades to "no BYOK key" (falling back to the shared key) rather than
 * sending a corrupted credential to the provider.
 */
function getRawAiApiKey(prefs: PreferenceMap): string | null {
  const stored = getStoredAiApiKey(prefs);
  if (stored === null) return null;
  const plaintext = decryptApiKey(stored);
  return plaintext && plaintext.trim().length > 0 ? plaintext.trim() : null;
}

/** The value exactly as persisted — still encrypted. Used to detect legacy rows. */
function getStoredAiApiKey(prefs: PreferenceMap): string | null {
  // Prefer new key, fallback to legacy
  const candidate = prefs[PREF_AI_API_KEY] ?? prefs[PREF_ANTHROPIC_API_KEY];
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeAiApiKey(apiKey: string): string {
  return apiKey.trim();
}

export function isLikelyAiApiKey(apiKey: string): boolean {
  const trimmed = sanitizeAiApiKey(apiKey);
  return (
    (trimmed.startsWith("sk-") || trimmed.startsWith("sk-ant-")) &&
    trimmed.length >= 20
  );
}

/** @deprecated Use {@link isLikelyAiApiKey} instead */
export const isLikelyAnthropicApiKey = isLikelyAiApiKey;

export function maskAiApiKey(apiKey: string): string {
  const trimmed = sanitizeAiApiKey(apiKey);
  if (trimmed.length <= 8) {
    return "••••";
  }

  return `${trimmed.slice(0, 7)}••••${trimmed.slice(-4)}`;
}

/** @deprecated Use {@link maskAiApiKey} instead */
export const maskAnthropicApiKey = maskAiApiKey;

export function getAiApiKeyFromUser(
  user: Models.User<Models.Preferences>,
): string | null {
  return getRawAiApiKey(normalizePreferences(user.prefs));
}

/** @deprecated Use {@link getAiApiKeyFromUser} instead */
export const getAnthropicApiKeyFromUser = getAiApiKeyFromUser;

export interface AiUsageStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastUsedAt: string | null;
}

/** @deprecated Use {@link AiUsageStats} instead */
export type AnthropicUsageStats = AiUsageStats;

export function getAiUsageStatsFromUser(
  user: Models.User<Models.Preferences>,
): AiUsageStats {
  const prefs = normalizePreferences(user.prefs);

  // Read new keys first, fallback to legacy keys for migration
  const calls =
    toNonNegativeInt(prefs[PREF_AI_USAGE_COUNT]) ||
    toNonNegativeInt(prefs[PREF_ANTHROPIC_USAGE_COUNT]);
  const inputTokens =
    toNonNegativeInt(prefs[PREF_AI_INPUT_TOKENS]) ||
    toNonNegativeInt(prefs[PREF_ANTHROPIC_INPUT_TOKENS]);
  const outputTokens =
    toNonNegativeInt(prefs[PREF_AI_OUTPUT_TOKENS]) ||
    toNonNegativeInt(prefs[PREF_ANTHROPIC_OUTPUT_TOKENS]);
  const totalTokens =
    toNonNegativeInt(prefs[PREF_AI_TOTAL_TOKENS]) ||
    toNonNegativeInt(prefs[PREF_ANTHROPIC_TOTAL_TOKENS]);
  const lastUsedAt =
    typeof prefs[PREF_AI_LAST_USED_AT] === "string"
      ? (prefs[PREF_AI_LAST_USED_AT] as string)
      : typeof prefs[PREF_ANTHROPIC_LAST_USED_AT] === "string"
        ? (prefs[PREF_ANTHROPIC_LAST_USED_AT] as string)
        : null;

  return { calls, inputTokens, outputTokens, totalTokens, lastUsedAt };
}

/** @deprecated Use {@link getAiUsageStatsFromUser} instead */
export const getAnthropicUsageStatsFromUser = getAiUsageStatsFromUser;

// `getLanguageModel(user, modelId)` used to live here and ignored both
// arguments, always returning the shared-key flash model. It made the BYOK
// feature look wired when it wasn't, and nothing imported it. Model selection
// now belongs to lib/ai/models.ts — call
// `getModelForPurpose(purpose, getAiApiKeyFromUser(user))`.

async function getUserPreferences(userId: string): Promise<PreferenceMap> {
  const prefs = await serverUsers.getPrefs({ userId });
  return normalizePreferences(prefs);
}

export async function getAiKeyStatusForUser(userId: string): Promise<{
  hasKey: boolean;
  maskedKey: string | null;
}> {
  const prefs = await getUserPreferences(userId);
  const apiKey = getRawAiApiKey(prefs);

  return {
    hasKey: Boolean(apiKey),
    maskedKey: apiKey ? maskAiApiKey(apiKey) : null,
  };
}

/** @deprecated Use {@link getAiKeyStatusForUser} instead */
export const getAnthropicKeyStatusForUser = getAiKeyStatusForUser;

export async function saveAiApiKeyForUser(
  userId: string,
  apiKey: string,
): Promise<{ maskedKey: string }> {
  const cleanedKey = sanitizeAiApiKey(apiKey);
  if (!isLikelyAiApiKey(cleanedKey)) {
    throw new Error("Invalid AI API key");
  }

  const prefs = await getUserPreferences(userId);
  const nextPrefs: PreferenceMap = {
    ...prefs,
    // Throws MissingEncryptionSecretError if AI_KEY_ENCRYPTION_SECRET is unset.
    // Failing the save is deliberate: silently falling back to plaintext would
    // reintroduce exactly the problem this is here to prevent, invisibly.
    [PREF_AI_API_KEY]: encryptApiKey(cleanedKey),
  };
  // The legacy pref held the same secret in plaintext; drop it rather than
  // leaving a readable copy behind the encrypted one.
  delete nextPrefs[PREF_ANTHROPIC_API_KEY];

  await serverUsers.updatePrefs({ userId, prefs: nextPrefs });

  return { maskedKey: maskAiApiKey(cleanedKey) };
}

/**
 * Re-write a plaintext key as ciphertext, once, on next use.
 *
 * Without this, keys saved before encryption existed would stay readable
 * forever — encrypting only new writes would leave the whole existing
 * population in the clear.
 */
export async function migrateAiApiKeyIfPlaintext(
  user: Models.User<Models.Preferences>,
): Promise<void> {
  const prefs = normalizePreferences(user.prefs);
  const stored = getStoredAiApiKey(prefs);
  if (stored === null || isEncrypted(stored)) return;

  try {
    const nextPrefs: PreferenceMap = { ...prefs, [PREF_AI_API_KEY]: encryptApiKey(stored) };
    delete nextPrefs[PREF_ANTHROPIC_API_KEY];
    await serverUsers.updatePrefs({ userId: user.$id, prefs: nextPrefs });
    console.log(`[ai-key] migrated plaintext key to ciphertext for user ${user.$id}`);
  } catch (error) {
    // Never fail the caller's request over this.
    console.error("[ai-key] plaintext migration failed:", error);
  }
}

/** @deprecated Use {@link saveAiApiKeyForUser} instead */
export const saveAnthropicApiKeyForUser = saveAiApiKeyForUser;

export async function removeAiApiKeyForUser(userId: string): Promise<void> {
  const prefs = await getUserPreferences(userId);
  const nextPrefs: PreferenceMap = { ...prefs };
  delete nextPrefs[PREF_AI_API_KEY];
  delete nextPrefs[PREF_ANTHROPIC_API_KEY];
  await serverUsers.updatePrefs({ userId, prefs: nextPrefs });
}

/** @deprecated Use {@link removeAiApiKeyForUser} instead */
export const removeAnthropicApiKeyForUser = removeAiApiKeyForUser;

export async function recordAiUsageForUser(
  userId: string,
  usage: AIUsageInfo,
): Promise<void> {
  try {
    const prefs = await getUserPreferences(userId);
    const nextPrefs: PreferenceMap = {
      ...prefs,
      [PREF_AI_USAGE_COUNT]:
        toNonNegativeInt(prefs[PREF_AI_USAGE_COUNT]) + 1,
      [PREF_AI_INPUT_TOKENS]:
        toNonNegativeInt(prefs[PREF_AI_INPUT_TOKENS]) +
        Math.max(0, usage.inputTokens ?? 0),
      [PREF_AI_OUTPUT_TOKENS]:
        toNonNegativeInt(prefs[PREF_AI_OUTPUT_TOKENS]) +
        Math.max(0, usage.outputTokens ?? 0),
      [PREF_AI_TOTAL_TOKENS]:
        toNonNegativeInt(prefs[PREF_AI_TOTAL_TOKENS]) +
        Math.max(0, usage.totalTokens ?? 0),
      [PREF_AI_LAST_USED_AT]: new Date().toISOString(),
    };

    await serverUsers.updatePrefs({ userId, prefs: nextPrefs });
  } catch (error) {
    console.error("[ai-usage] Failed to persist AI usage:", error);
  }
}

/** @deprecated Use {@link recordAiUsageForUser} instead */
export const recordAnthropicUsageForUser = recordAiUsageForUser;

import { recordAiUsageEvent, type UsageEventData } from '@/lib/ai/usage-events';

/**
 * Combined helper: updates prefs lifetime counters AND writes usage event to table.
 * Use this in onUsage callbacks from generateTextWithLogging / streamTextWithLogging.
 */
export async function recordAiUsage(
  userId: string,
  feature: string,
  usage: AIUsageInfo,
  options?: { canvasId?: string; model?: string },
): Promise<void> {
  // Update lifetime prefs (fast, for dashboard display)
  await recordAiUsageForUser(userId, usage);

  // Write detailed event (for quota enforcement, per-feature breakdown, cost tracking)
  const eventData: UsageEventData = {
    userId,
    feature,
    model: options?.model ?? usage.modelId ?? 'deepseek-v4-flash',
    usage,
    ...(options?.canvasId ? { canvasId: options.canvasId } : {}),
    ...(usage.cacheHitTokens !== undefined ? { cacheHitTokens: usage.cacheHitTokens } : {}),
    ...(usage.cacheMissTokens !== undefined ? { cacheMissTokens: usage.cacheMissTokens } : {}),
  };

  await recordAiUsageEvent(eventData);
}
