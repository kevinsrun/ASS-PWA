import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

type ExportMessage = { id?: string; author?: { role?: string }; create_time?: number; content?: { parts?: unknown[] } };
type ExportNode = { message?: ExportMessage };
type ExportConversation = { id?: string; conversation_id?: string; title?: string; create_time?: number; update_time?: number; mapping?: Record<string, ExportNode> };

function conversationsJson(buffer: Buffer, name: string) {
  if (!name.toLowerCase().endsWith(".zip")) return buffer.toString("utf8");
  const marker = Buffer.from("conversations.json");
  const at = buffer.indexOf(marker);
  if (at < 46) throw new Error("This ZIP does not contain conversations.json.");
  const central = at - 46;
  if (buffer.readUInt32LE(central) !== 0x02014b50) throw new Error("The ChatGPT ZIP directory is invalid.");
  const method = buffer.readUInt16LE(central + 10);
  const compressedSize = buffer.readUInt32LE(central + 20);
  const localOffset = buffer.readUInt32LE(central + 42);
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("The ChatGPT ZIP entry is invalid.");
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const compressed = buffer.subarray(localOffset + 30 + nameLength + extraLength, localOffset + 30 + nameLength + extraLength + compressedSize);
  if (method === 0) return compressed.toString("utf8");
  if (method === 8) return inflateRawSync(compressed).toString("utf8");
  throw new Error("This ZIP compression method is not supported.");
}

function role(value?: string) {
  if (value === "user") return "user_written";
  if (value === "assistant") return "assistant_generated";
  if (value === "system") return "system_context";
  if (value === "tool") return "project_context";
  return "unknown";
}

function content(message: ExportMessage) {
  return (message.content?.parts ?? []).filter((part): part is string => typeof part === "string").join("\n").trim();
}

function memoryCandidates(text: string, sourceId: string) {
  const patterns: Array<[RegExp, string, string, number]> = [
    [/\bmy goal is\s+([^.!?]{4,220})/gi, "goal", "general", 85],
    [/\bi (?:want|hope|aspire) to\s+([^.!?]{4,220})/gi, "aspiration", "general", 75],
    [/\bi prefer\s+([^.!?]{4,220})/gi, "preference", "scheduling", 70],
    [/\bi (?:hate|dislike|avoid)\s+([^.!?]{4,220})/gi, "dislike", "general", 65],
  ];
  return patterns.flatMap(([pattern, kind, category, importance]) => [...text.matchAll(pattern)].slice(0, 3).map((match) => ({ kind, category, statement: match[0].trim(), confidence: .72, importance, source_type: "chatgpt", source_id: sourceId, evidence: [{ excerpt: match[0].trim() }] })));
}

export async function importChatGPTExport(userId: string, file: { name: string; buffer: Buffer }) {
  const parsed = JSON.parse(conversationsJson(file.buffer, file.name));
  if (!Array.isArray(parsed)) throw new Error("conversations.json must contain an array.");
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  let messages = 0; let userMessages = 0; let memories = 0;
  for (const conversation of (parsed as ExportConversation[]).slice(0, 5000)) {
    const externalId = String(conversation.id ?? conversation.conversation_id ?? createHash("sha256").update(JSON.stringify(conversation).slice(0, 1000)).digest("hex"));
    const iso = (value?: number) => value ? new Date(value * 1000).toISOString() : null;
    const { data: saved, error } = await supabase.from("chatgpt_conversations").upsert({ user_id: userId, external_id: externalId, title: String(conversation.title ?? "Untitled conversation").slice(0, 300), started_at: iso(conversation.create_time), updated_at: iso(conversation.update_time) }, { onConflict: "user_id,external_id" }).select("id").single();
    if (error || !saved) throw error ?? new Error("Could not save ChatGPT conversation.");
    for (const [nodeId, node] of Object.entries(conversation.mapping ?? {})) {
      if (!node.message) continue;
      const text = content(node.message); if (!text) continue;
      const classifiedRole = role(node.message.author?.role);
      const messageId = String(node.message.id ?? `${externalId}:${nodeId}`);
      const { error: messageError } = await supabase.from("chatgpt_messages").upsert({ user_id: userId, conversation_id: saved.id, external_id: messageId, role: classifiedRole, content: text.slice(0, 100000), authored_at: iso(node.message.create_time) }, { onConflict: "user_id,external_id" });
      if (messageError) throw messageError;
      messages += 1;
      if (classifiedRole === "user_written") {
        userMessages += 1;
        for (const candidate of memoryCandidates(text, messageId)) {
          const { error: memoryError } = await supabase.from("personal_memory").upsert({ user_id: userId, ...candidate }, { onConflict: "user_id,kind,category,statement" });
          if (memoryError) throw memoryError; memories += 1;
        }
      }
    }
  }
  return { conversations: Math.min(parsed.length, 5000), messages, userMessages, memories };
}
