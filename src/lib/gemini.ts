import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import { GEMINI_MODELS } from "@/lib/geminiModels";

const keys =
  process.env.GEMINI_API_KEYS?.split(",")
    .map((k) => k.trim())
    .filter(Boolean) ?? [];

let currentKeyIndex = 0;

export function getGeminiModel(
  model = GEMINI_MODELS.reasoning,
  responseSchema?: Schema,
  thinkingLevel: "low" | "high" = "high",
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
