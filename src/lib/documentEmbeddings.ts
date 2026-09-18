export const documentEmbeddingModel = "gemini-embedding-2";
export async function embedDocumentText(
  text: string,
  kind: "document" | "question",
  title = "none",
) {
  const key = process.env.GEMINI_API_KEYS?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  if (!key)
    throw new Error(
      "Gemini embedding key is not configured; indexed text retrieval remains available.",
    );
  const content =
    kind === "question"
      ? `task: question answering | query: ${text}`
      : `title: ${title} | text: ${text}`;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${documentEmbeddingModel}:embedContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: `models/${documentEmbeddingModel}`,
        content: { parts: [{ text: content }] },
        outputDimensionality: 768,
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Gemini semantic indexing unavailable: HTTP ${response.status}. Indexed text retrieval remains available.`,
    );
  const data = await response.json(),
    values = data.embedding?.values;
  if (
    !Array.isArray(values) ||
    values.length !== 768 ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  )
    throw new Error(
      "Gemini returned an invalid embedding; indexed text retrieval remains available.",
    );
  return values as number[];
}
