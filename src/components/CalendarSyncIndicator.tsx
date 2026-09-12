"use client";

import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from "lucide-react";
import type { CalendarSyncStatus } from "@/lib/types";

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(value).toLocaleString();
}

export function syncStatusCopy(status: CalendarSyncStatus, loading = false) {
  if (loading || status.state === "syncing") return "Syncing Google Calendar…";
  if (status.state === "synced" && status.lastSuccessfulSyncAt) {
    return `Synced ${relativeTime(status.lastSuccessfulSyncAt)}`;
  }
  if (status.state === "auth_expired") return "Calendar authentication expired";
  if (status.state === "unreachable") return "Unable to reach Google Calendar";
  if (status.state === "misconfigured") return "Calendar setup incomplete";
  if (status.state === "error") return "Calendar sync failed";
  if (status.connected) return status.lastSuccessfulSyncAt
    ? `Synced ${relativeTime(status.lastSuccessfulSyncAt)}`
    : "Google Calendar connected";
  return "Google Calendar not connected";
}

export default function CalendarSyncIndicator({
  status,
  loading,
  onSync,
  onConnect,
  compact = false,
}: {
  status: CalendarSyncStatus;
  loading: boolean;
  onSync: () => void;
  onConnect: () => void;
  compact?: boolean;
}) {
  const healthy = status.state === "synced" || status.state === "ready";
  const needsAuthorization =
    !status.connected || status.state === "auth_expired";
  const Icon = loading
    ? RefreshCw
    : healthy
      ? CheckCircle2
      : status.state === "not_connected"
        ? CloudOff
        : AlertTriangle;

  return (
    <div className={`calendar-sync-indicator ${healthy ? "is-healthy" : "is-warning"}`}>
      <Icon size={18} className={loading ? "animate-spin" : ""} aria-hidden="true" />
      <div>
        <strong>{syncStatusCopy(status, loading)}</strong>
        {!compact && status.connectedEmail ? (
          <span>
            {status.connectedEmail}
            {status.calendars.length > 0
              ? ` · ${status.calendars.length} calendar${status.calendars.length === 1 ? "" : "s"}`
              : ""}
          </span>
        ) : null}
        {!compact && status.error ? <span>{status.error}</span> : null}
      </div>
      <button
        type="button"
        onClick={needsAuthorization ? onConnect : onSync}
        disabled={loading}
      >
        {status.state === "auth_expired"
          ? "Reconnect"
          : status.connected
            ? "Sync now"
            : "Connect"}
      </button>
    </div>
  );
}
