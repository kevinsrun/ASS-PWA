import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request); const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const { data, error } = await supabase.from("personal_memory").select("id,kind,category,statement,confidence,importance,source_type,updated_at").eq("user_id", user.id).eq("active", true).order("importance", { ascending: false }).limit(100);
    if (error) throw error; return NextResponse.json({ memory: data ?? [] });
  } catch (error) { const status = error instanceof ApiAuthError ? error.status : 500; return NextResponse.json({ error: error instanceof Error ? error.message : "Memory unavailable." }, { status }); }
}
