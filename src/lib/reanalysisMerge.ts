import { preserveReviewedExtraction } from "@/lib/classificationGuardrails";
const norm = (value: unknown) => String(value ?? "").replace(/\s+/g," ").trim().toLowerCase();
type ExistingItem = { id: string; title?: string; description?: string; payload?: Record<string, unknown>; due_at?: string | null; normalized_type?: string; review_status?: string; manual_corrected_at?: string | null; ignore_future_imports?: boolean; deleted_at?: string | null };
type NewItem = { title: string; payload: Record<string, unknown>; dueAt: string | null; normalizedType: string };
export function planReanalysisMerge<T extends NewItem>(existing: ExistingItem[], incoming: T[]) {
  const matches = (old: ExistingItem, item: T) => {
    const a = norm(old.payload?.evidence_text), b = norm(item.payload.evidence_text);
    return (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))) || norm(old.title) === norm(item.title)
      || (Boolean(old.due_at && item.dueAt) && Date.parse(old.due_at!) === Date.parse(item.dueAt!) && old.normalized_type === item.normalizedType);
  };
  const used = new Set<string>();
  const updates: Array<{ id: string; item: T }> = [], additions: T[] = [];
  let preserved = 0;
  for (const item of incoming) {
    if (existing.some(old => preserveReviewedExtraction(old) && matches(old,item))) { preserved++; continue; }
    const match = existing.find(old => !used.has(old.id) && !preserveReviewedExtraction(old) && matches(old,item));
    if (match) { used.add(match.id); updates.push({id:match.id,item}); }
    else if (!additions.some(added => norm(added.payload.evidence_text) === norm(item.payload.evidence_text))) additions.push(item);
  }
  return { updates, additions, preserved, unmatched: existing.filter(old => !used.has(old.id) && !preserveReviewedExtraction(old)).map(old => old.id) };
}
