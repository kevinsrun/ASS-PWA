import { GoogleGenerativeAI } from "@google/generative-ai";

const keys =
  process.env.GEMINI_API_KEYS?.split(",").map((k) => k.trim()) ?? [];

let currentKeyIndex = 0;

export function getGeminiModel(model = "gemini-2.5-flash") {
  if (keys.length === 0) {
    throw new Error("No Gemini API keys configured");
  }

  const key = keys[currentKeyIndex];

  const genAI = new GoogleGenerativeAI(key);

  return genAI.getGenerativeModel({
    model,
  });
}

export function rotateGeminiKey() {
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  console.log("Rotated Gemini key:", currentKeyIndex);
}