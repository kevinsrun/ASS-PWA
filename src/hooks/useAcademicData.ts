"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AcademicAssignmentRow,
  AcademicCourseRow,
  AcademicResourceRow,
  academicSnapshotFromRows,
  emptyAcademicSnapshot,
} from "@/lib/academic";
import { getBrowserSupabaseClient } from "@/lib/supabaseBrowser";
import { AcademicSnapshot, CourseStatus } from "@/lib/types";
import { useAuth } from "@/providers/AuthProvider";

export function useAcademicData() {
  const { session, user } = useAuth();
  const [snapshot, setSnapshot] = useState<AcademicSnapshot>(emptyAcademicSnapshot());
  const [loading, setLoading] = useState(Boolean(user));
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    if (!supabase || !user) {
      setSnapshot(emptyAcademicSnapshot());
      setLoading(false);
      return;
    }

    setLoading(true);
    const [courses, assignments, resources, latestSync] = await Promise.all([
      supabase.from("academic_courses").select("*").order("name"),
      supabase
        .from("academic_assignments")
        .select("*")
        .order("due_at", { ascending: true, nullsFirst: false }),
      supabase
        .from("academic_resources")
        .select("*")
        .order("published_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("academic_sync_runs")
        .select("completed_at")
        .eq("status", "ok")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const queryError = courses.error ?? assignments.error ?? resources.error;
    if (queryError) {
      setError(queryError.message);
    } else {
      setSnapshot(
        academicSnapshotFromRows(
          (courses.data ?? []) as unknown as AcademicCourseRow[],
          (assignments.data ?? []) as unknown as AcademicAssignmentRow[],
          (resources.data ?? []) as unknown as AcademicResourceRow[],
          (latestSync.data?.completed_at as string | undefined) ?? null
        )
      );
      setError(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = useCallback(async () => {
    if (!session?.access_token) {
      setError("Sign in before syncing Canvas.");
      return;
    }

    setSyncing(true);
    setError(null);
    try {
      const response = await fetch("/api/canvas/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = (await response.json()) as AcademicSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Canvas sync failed.");
      setSnapshot(body);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Canvas sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [session?.access_token]);

  const updateCourseStatus = useCallback(
    async (courseId: string, status: CourseStatus) => {
      const supabase = getBrowserSupabaseClient();
      if (!supabase || !user) return;
      const previous = snapshot;
      setSnapshot((current) => ({
        ...current,
        courses: current.courses.map((course) =>
          course.id === courseId ? { ...course, status } : course
        ),
      }));
      const { error: updateError } = await supabase
        .from("academic_courses")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", courseId);
      if (updateError) {
        setSnapshot(previous);
        setError(updateError.message);
      }
    },
    [snapshot, user]
  );

  return { snapshot, loading, syncing, error, reload: load, sync, updateCourseStatus };
}
