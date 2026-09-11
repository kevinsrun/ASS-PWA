import { NextRequest } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabaseServer";

export class ApiAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

export async function requireApiUser(request: NextRequest | Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!token) throw new ApiAuthError("Sign in to continue.");

  const supabase = getServerSupabaseClient();
  if (!supabase) {
    throw new ApiAuthError("Supabase server configuration is missing.", 503);
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiAuthError("Your ASS session has expired. Sign in again.");
  }

  return data.user;
}
