import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cronAuth";
import { getServerSupabaseClient, logCronRun } from "@/lib/supabaseServer";

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  try {
    const supabase = getServerSupabaseClient();
    const today = new Date().toISOString().split("T")[0];
    let overdueTodos = 0;
    let pendingHabits = 0;
    let storageWarning = "";

    if (supabase) {
      const todos = await supabase
        .from("todos")
        .select("id", { count: "exact", head: true })
        .eq("done", false)
        .lt("due_date", today);
      const habits = await supabase
        .from("habits")
        .select("id", { count: "exact", head: true });

      overdueTodos = todos.count ?? 0;
      pendingHabits = habits.count ?? 0;
      storageWarning = todos.error?.message ?? habits.error?.message ?? "";
    }

    const details = {
      date: today,
      overdueTodos,
      pendingHabits,
      storageWarning,
      note: "Evening review hook is ready for reminders/weekly review generation once Supabase tables and push subscriptions are active.",
    };
    const log = await logCronRun("evening", "ok", details);

    return NextResponse.json({
      ok: true,
      job: "evening",
      ...details,
      log,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cron error";
    const log = await logCronRun("evening", "error", { message });

    return NextResponse.json(
      {
        ok: false,
        job: "evening",
        error: message,
        log,
      },
      { status: 500 }
    );
  }
}
