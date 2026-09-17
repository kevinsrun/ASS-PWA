import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";

const keys =
  process.env.GEMINI_API_KEYS?.split(",").map((k) => k.trim()) ?? [];

let currentKeyIndex = 0;

export function getGeminiModel(model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash", responseSchema?: Schema) {
  if (keys.length === 0) {
    throw new Error("No Gemini API keys configured");
  }

  const key = keys[currentKeyIndex];

  const genAI = new GoogleGenerativeAI(key);

  return genAI.getGenerativeModel({
    model,
    ...(responseSchema ? { generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.1 } } : {}),
  });
}

export function rotateGeminiKey() {
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  console.log("Rotated Gemini key:", currentKeyIndex);
}
