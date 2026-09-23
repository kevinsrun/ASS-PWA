import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import { GEMINI_MODELS } from "@/lib/geminiModels";
import {trackAIUsage} from "@/lib/ai/cache";

const keys =
  process.env.GEMINI_API_KEYS?.split(",")
    .map((k) => k.trim())
    .filter(Boolean) ?? [];

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

  console.log("Rotated Gemini key:", currentKeyIndex);
}
