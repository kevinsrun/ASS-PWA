"use client";

import { useCallback, useEffect, useState } from "react";
import type { CalendarSyncStatus } from "@/lib/types";
import { useAuth } from "@/providers/AuthProvider";

const initialStatus: CalendarSyncStatus = {
  state: "not_connected",
  connected: false,
  lastSuccessfulSyncAt: null,
  lastAttemptAt: null,
  error: null,
  timeZone: null,
};

export function useCalendarSync(onSynced?: () => Promise<void> | void) {
  const { session } = useAuth();
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(true);

  const request = useCallback(
    async (method: "GET" | "POST") => {
      if (!session?.access_token) {
        setStatus(initialStatus);
        setLoading(false);
        return initialStatus;
      }

      const response = await fetch("/api/calendar/sync", {
        method,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body:
          method === "POST"
            ? JSON.stringify({
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              })
            : undefined,
      });
      const body = (await response.json().catch(() => ({}))) as
        | CalendarSyncStatus
        | { error?: string };
      if (!("state" in body)) {
        throw new Error(body.error ?? "Calendar sync did not return a status.");
      }
      setStatus(body);
      return body;
    },
    [session?.access_token]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await request("GET");
    } catch (error) {
      setStatus({
        ...initialStatus,
        state: "unreachable",
        error: error instanceof Error ? error.message : "Unable to check calendar sync.",
      });
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const syncNow = useCallback(async () => {
    setLoading(true);
    setStatus((current) => ({ ...current, state: "syncing", error: null }));
    try {
      const result = await request("POST");
      if (result.state === "synced") await onSynced?.();
      return result;
    } catch (error) {
      const next = {
        ...initialStatus,
        state: "unreachable" as const,
        error: error instanceof Error ? error.message : "Unable to reach calendar sync.",
      };
      setStatus(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, [onSynced, request]);

  const connect = useCallback(async () => {
    if (!session?.access_token) {
      window.location.assign("/login");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !body.url) {
        throw new Error(body.error ?? "Unable to start Google authorization.");
      }
      window.location.assign(body.url);
    } catch (error) {
      setStatus({
        ...initialStatus,
        state: "misconfigured",
        error: error instanceof Error ? error.message : "Google connection failed.",
      });
      setLoading(false);
    }
  }, [session?.access_token]);

  return { status, loading, signedIn: Boolean(session), refresh, syncNow, connect };
}
