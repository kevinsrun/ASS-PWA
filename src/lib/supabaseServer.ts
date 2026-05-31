import { createClient } from "@supabase/supabase-js";

export function getServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function logCronRun(
  job: string,
  status: "ok" | "error",
  details: Record<string, unknown>
) {
  const supabase = getServerSupabaseClient();

  if (!supabase) {
    return { stored: false, reason: "Supabase env is not configured" };
  }

  const { error } = await supabase.from("cron_runs").insert({
    job,
    status,
    details,
    ran_at: new Date().toISOString(),
  });

  if (error) {
    return { stored: false, reason: error.message };
  }

  return { stored: true };
}
