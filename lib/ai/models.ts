import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

const deepseek = createOpenAI({
  baseURL: DEEPSEEK_BASE_URL,
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
});

export const flashModel: LanguageModel = deepseek.chat('deepseek-v4-flash');
export const proModel: LanguageModel = deepseek.chat('deepseek-v4-pro');

export type ModelPurpose = 'fast' | 'reasoning';

export function getModelIdForPurpose(purpose: ModelPurpose): string {
  return purpose === 'reasoning' ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
}

/**
 * Providers are cached per key so a burst of requests from one user doesn't
 * build a new client per call. Keyed by the API key itself, which never leaves
 * the server process.
 */
const providerCache = new Map<string, ReturnType<typeof createOpenAI>>();

function providerForKey(apiKey: string) {
  let provider = providerCache.get(apiKey);
  if (!provider) {
    provider = createOpenAI({ baseURL: DEEPSEEK_BASE_URL, apiKey });
    providerCache.set(apiKey, provider);
  }
  return provider;
}

/**
 * Select the model for a purpose.
 * - 'fast': chat, drafting, guided-create (flash)
 * - 'reasoning': analysis, consistency checker, deep-dive, viability (pro)
 *
 * `userApiKey` is the caller's own DeepSeek key from settings, when they have
 * saved one — pass `getAiApiKeyFromUser(user)`. Calls then bill to their
 * account instead of the shared `DEEPSEEK_API_KEY`. This was the missing half
 * of the BYOK feature: the settings page stored a key and nothing ever read it,
 * so every request silently ran on the shared key.
 *
 * Quota is deliberately still enforced on top of this — see checkAiQuota. A
 * user's own key changes who pays the provider, not the app's own rate limits.
 */
export function getModelForPurpose(
  purpose: ModelPurpose,
  userApiKey?: string | null,
): LanguageModel {
  const modelId = getModelIdForPurpose(purpose);
  if (userApiKey) {
    return providerForKey(userApiKey).chat(modelId);
  }
  return purpose === 'reasoning' ? proModel : flashModel;
}
