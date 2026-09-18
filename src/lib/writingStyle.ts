import { getGeminiModel, rotateGeminiKey } from "@/lib/gemini";
import { GEMINI_MODELS } from "@/lib/geminiModels";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

const contexts = new Set(["formal_email", "professor_email", "club_application", "scholarship_essay", "casual_message", "academic_writing", "reflective_writing", "business_sales", "unknown"]);
const spanTypes = new Set(["user_written", "ai_generated", "prompt_question", "instructions", "source_material", "dataset", "unknown"]);

export async function classifyWritingSpans(userId: string, importedSourceId: string, content: string, sourceKind: "drive" | "imessage_manual") {
  const trimmed = content.trim().slice(0, 120_000);
  if (!trimmed) return { samples: 0, approved: 0 };
  const prompt = `Classify spans in this user-selected writing sample. Return only a JSON array with objects {spanType,contextType,content,confidence}.
Allowed spanType: user_written, ai_generated, prompt_question, instructions, source_material, dataset, unknown.
Allowed contextType: formal_email, professor_email, club_application, scholarship_essay, casual_message, academic_writing, reflective_writing, business_sales, unknown.
Do not label prompts, questions, rubrics, instructions, quoted material, copied source text, datasets, or obvious AI prose as user_written. For an iMessage manual import, the user has confirmed the pasted content contains only messages they sent, but still exclude copied quotations. Split mixed documents into separate spans. Keep at most 40 representative spans.
Source: ${sourceKind}
Content:\n${trimmed}`;
  let result;
  try { result = await getGeminiModel().generateContent(prompt); }
  catch (error) { if (!String(error).includes("429")) throw error; rotateGeminiKey(); result = await getGeminiModel().generateContent(prompt); }
  let parsed: Array<Record<string, unknown>> = [];
  try { const raw = JSON.parse(result.response.text().replace(/```json|```/g, "").trim()); parsed = Array.isArray(raw) ? raw : []; }
  catch { console.warn(JSON.stringify({ service: "writing-style", stage: "invalid-model-json", importedSourceId })); return { samples: 0, approved: 0 }; }
  const rows = parsed.slice(0, 40).flatMap((value) => {
    const spanType = String(value.spanType ?? "unknown"); const contextType = String(value.contextType ?? "unknown"); const sample = String(value.content ?? "").trim().slice(0, 8000); const confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0));
    if (!sample || !spanTypes.has(spanType) || !contexts.has(contextType)) return [];
    return [{ user_id: userId, imported_source_id: importedSourceId, source_kind: sourceKind, context_type: contextType, span_type: spanType, content: sample, confidence, approved: spanType === "user_written" && confidence >= 0.9 }];
  });
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  if (rows.length) { const { error } = await supabase.from("writing_samples").insert(rows); if (error) throw error; }
  for (const contextType of [...new Set(rows.filter((row) => row.approved).map((row) => row.context_type))]) {
    const approved = rows.filter((row) => row.approved && row.context_type === contextType);
    const { error } = await supabase.from("writing_style_profiles").upsert({ user_id: userId, context_type: contextType, traits: { source: "high-confidence-user-spans", guidance: "Match the user's vocabulary, sentence length, directness, and sign-off patterns without copying facts.", sampleIds: approved.map((_, index) => `${importedSourceId}:${index}`) }, sample_count: approved.length, model: GEMINI_MODELS.fast, updated_at: new Date().toISOString() }, { onConflict: "user_id,context_type" });
    if (error) throw error;
  }
  console.info(JSON.stringify({ service: "writing-style", stage: "classified", importedSourceId, samples: rows.length, approved: rows.filter((row) => row.approved).length }));
  return { samples: rows.length, approved: rows.filter((row) => row.approved).length };
}
