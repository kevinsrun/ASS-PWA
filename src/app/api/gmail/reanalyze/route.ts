import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, ApiAuthError } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { scanRecentGmailSuggestions } from "@/lib/gmailScan";
export const maxDuration=300;
export async function POST(request:NextRequest) {
  try {
    const user=await requireApiUser(request);
    const body=await request.json() as {id?:unknown};
    if(typeof body.id!=="string" || !/^\d+$/.test(body.id)) throw new ApiAuthError("Choose an email to re-analyze",400);
    const db=getServiceSupabaseClient(); if(!db) throw new Error("A Supabase server key is not configured");
    const {data,error}=await db.from("email_suggestions").select("external_id,google_account_id").eq("user_id",user.id).eq("id",body.id).maybeSingle();
    if(error) throw error;
    if(!data?.google_account_id) throw new ApiAuthError("Email not found",404);
    const result=await scanRecentGmailSuggestions(user.id,data.google_account_id,data.external_id);
    return NextResponse.json(result,{status:result.busy ? 409 : result.failures.length ? 422 : 200});
  }catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : "Reanalysis failed"},{status:error instanceof ApiAuthError ? error.status : 500}); }
}
