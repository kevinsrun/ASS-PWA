export const GEMINI_MODELS = {
  fast:
    process.env.GEMINI_MODEL_FAST?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    "gemini-3.8-flash",
  reasoning:
    process.env.GEMINI_MODEL_REASONING?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    "gemini-3.8-flash",
  fallback: process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.6-flash",
};
