import { NextRequest, NextResponse } from "next/server";
import { getFinanceDashboard } from "@/lib/finance";
import { plaidConfiguration } from "@/lib/plaid";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

const assumptionKeys = [
  "expected_scholarships", "expected_paychecks", "expected_family_support",
  "monthly_tuition", "monthly_housing", "monthly_food", "monthly_transportation",
  "monthly_books", "emergency_reserve", "savings_target",
] as const;

function failure(error: unknown) {
  const status = error instanceof ApiAuthError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Finance request failed" }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const config = plaidConfiguration();
    if (!config.ready) return NextResponse.json({ configured: false, connected: false, missing: config.missing });
    return NextResponse.json(await getFinanceDashboard(user.id));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as Record<string, unknown>;
    const values: Record<string, number | string> = { user_id: user.id, updated_at: new Date().toISOString() };
    for (const key of assumptionKeys) {
      const value = Number(body[key]);
      if (Number.isFinite(value) && value >= 0) values[key] = Math.min(value, 100_000_000);
    }
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const { error } = await supabase.from("finance_assumptions").upsert(values, { onConflict: "user_id" });
    if (error) throw error;
    return NextResponse.json(await getFinanceDashboard(user.id));
  } catch (error) {
    return failure(error);
  }
}
