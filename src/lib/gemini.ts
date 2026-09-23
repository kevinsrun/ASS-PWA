import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import { createHash } from "crypto";
import { GEMINI_MODELS } from "@/lib/geminiModels";
import {trackAIUsage} from "@/lib/ai/cache";

const configuredKeyValues = [
  process.env.GEMINI_API_KEYS ?? "",
  ...Array.from({ length: 8 }, (_, index) =>
    process.env[`GEMINI_API_KEY_${index + 1}`] ?? "",
  ),
];
const discoveredKeys = configuredKeyValues
  .flatMap((value) => value.split(","))
  .map((key) => key.trim())
  .filter(Boolean);
const keys = discoveredKeys.filter(
  (key, index) =>
    discoveredKeys.findIndex((candidate) => candidate === key) === index,
);
const duplicateKeyFingerprints = discoveredKeys
  .filter((key, index) => discoveredKeys.indexOf(key) !== index)
  .map((key) => createHash("sha256").update(key).digest("hex").slice(0, 8));
const keyFingerprints = keys.map((key) =>
  createHash("sha256").update(key).digest("hex").slice(0, 8),
);
const projectIds = (process.env.GEMINI_PROJECT_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

let currentKeyIndex = 0;

export type GeminiFailureCategory =
  | "QUOTA_RATE_LIMIT"
  | "TRANSIENT_MODEL_UNAVAILABLE"
  | "AUTH_CONFIGURATION_ERROR"
  | "PROVIDER_TIMEOUT"
  | "CALLER_ABORTED"
  | "JOB_TIMEOUT"
  | "ROUTE_TIMEOUT"
  | "QUEUE_CANCELLED"
  | "UNKNOWN_PROVIDER_ERROR";

export type GeminiAbortContext = {
  abortSource?: "caller" | "job" | "route" | "queue";
  elapsedMs?: number;
  timeoutMs?: number;
};

export function classifyGeminiFailure(
  error: unknown,
  context?: GeminiAbortContext,
): {
  category: GeminiFailureCategory;
  status: number | null;
  retryable: boolean;
  coolKey: boolean;
} & GeminiAbortContext {
  const message = String(error);
  const status = Number((error as { status?: number })?.status) || Number(message.match(/\b(401|403|408|429|500|502|503|504)\b/)?.[1]) || null;
  if (status === 401 || status === 403 || /invalid api key|api key.*(?:invalid|revoked)|unauthori[sz]ed|forbidden/i.test(message))
    return { category: "AUTH_CONFIGURATION_ERROR", status, retryable: false, coolKey: false };
  if (status === 429 || /quota|rate limit|resource exhausted|too many requests/i.test(message))
    return { category: "QUOTA_RATE_LIMIT", status, retryable: true, coolKey: true };
  if (status === 503 || status === 500 || status === 502 || status === 504 || /service unavailable|temporarily unavailable|high demand/i.test(message))
    return { category: "TRANSIENT_MODEL_UNAVAILABLE", status, retryable: true, coolKey: false };
  if (context?.abortSource === "caller")
    return { category: "CALLER_ABORTED", status, retryable: false, coolKey: false, ...context };
  if (context?.abortSource === "job")
    return { category: "JOB_TIMEOUT", status, retryable: false, coolKey: false, ...context };
  if (context?.abortSource === "route")
    return { category: "ROUTE_TIMEOUT", status, retryable: false, coolKey: false, ...context };
  if (context?.abortSource === "queue")
    return { category: "QUEUE_CANCELLED", status, retryable: false, coolKey: false, ...context };
  if (status === 408 || /timeout|timed out|deadline exceeded|socket|fetch failed/i.test(message))
    return { category: "PROVIDER_TIMEOUT", status, retryable: true, coolKey: false, ...context };
  if ((error as { name?: string })?.name === "AbortError" || /operation was aborted|request aborted/i.test(message))
    return { category: "PROVIDER_TIMEOUT", status, retryable: true, coolKey: false, ...context };
  return { category: "UNKNOWN_PROVIDER_ERROR", status, retryable: false, coolKey: false };
}

export function getGeminiKeySlot() {
  return currentKeyIndex;
}

export function getGeminiKeyPoolDiagnostics() {
  const configured = discoveredKeys.length;
  return {
    environment: process.env.VERCEL_ENV ?? "development",
    configuredKeySlots: configured,
    usableKeySlots: keys.length,
    missingSlots: Array.from({ length: Math.max(0, 8 - configured) }, (_, index) =>
      configured + index,
    ),
    duplicateKeyFingerprints: [...new Set(duplicateKeyFingerprints)],
    keyFingerprints,
    projectSlots: keys.map((_, index) => projectIds[index] ?? null),
  };
}

export function getGeminiKeyPoolSize() {
  return keys.length;
}

export function selectGeminiKeySlot(slot: number) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= keys.length)
    throw new Error(`Gemini key slot ${slot} is unavailable`);
  currentKeyIndex = slot;
}

export function getGeminiModel(
  model = GEMINI_MODELS.reasoning,
  responseSchema?: Schema,
  thinkingLevel: "low" | "high" = "high",
  options: { allowModelFallback?: boolean } = {},
) {
  if (keys.length === 0) {
    throw new Error("No Gemini API keys configured");
  }

  const key = keys[currentKeyIndex];

  const genAI = new GoogleGenerativeAI(key);

  const selected = genAI.getGenerativeModel({
    model,
    generationConfig: {
      ...(responseSchema
        ? {
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.1,
          }
        : {}),
      ...(/^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel } } : {}),
    },
  });
  const generate = selected.generateContent.bind(selected);
  selected.generateContent = async (...args) => {
    trackAIUsage("gemini_request",model);
    try {
      const result = await generate(...args);
      console.info(
        JSON.stringify({
          service: "gemini",
          stage: "generation-completed",
          model,
        keySlot: currentKeyIndex,
        projectId: projectIds[currentKeyIndex] ?? null,
        thinkingLevel,
        }),
      );
      return result;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const fallback = GEMINI_MODELS.fallback;
      if (
        options.allowModelFallback !== true ||
        model === fallback ||
        !model.includes("flash") ||
        !(
          status === 503 ||
          (status === 404 &&
            /model.*(?:no longer available|not found)/i.test(String(error)))
        )
      )
        throw error;
      console.warn(
        JSON.stringify({
          service: "gemini",
          stage: "model-fallback",
          from: model,
          to: fallback,
          status,
        }),
      );
      trackAIUsage("gemini_fallback",fallback);
      trackAIUsage("gemini_request",fallback);
      const result = await genAI
        .getGenerativeModel({
          model: fallback,
          generationConfig: {
            ...(responseSchema
              ? {
                  responseMimeType: "application/json",
                  responseSchema,
                  temperature: 0.1,
                }
              : {}),
            ...(/^gemini-3/.test(fallback)
              ? { thinkingConfig: { thinkingLevel } }
              : {}),
          },
        })
        .generateContent(...args);
      console.info(
        JSON.stringify({
          service: "gemini",
          stage: "generation-completed",
          model: fallback,
          requestedModel: model,
          thinkingLevel,
        }),
      );
      return result;
    }
  };
  return selected;
}

export function rotateGeminiKey() {
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  console.log(
    JSON.stringify({
      service: "gemini",
      stage: "key-rotated",
      keySlot: currentKeyIndex,
      projectId: projectIds[currentKeyIndex] ?? null,
    }),
  );
}
