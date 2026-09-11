"use client";

import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Cloud,
  Github,
  LogOut,
  UserRound,
} from "lucide-react";
import CalendarSyncIndicator from "@/components/CalendarSyncIndicator";
import { useCalendarSync } from "@/hooks/useCalendarSync";
import { useAppContext } from "@/providers/AppProvider";
import { useAuth } from "@/providers/AuthProvider";

export default function ProfilePage() {
  const { profile, syncStatus, updateProfile, reloadCloud } = useAppContext();
  const { configured, user, signOut } = useAuth();
  const calendarSync = useCalendarSync(reloadCloud);
  const initials = (profile.displayName || user?.email || "A")
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <main className="settings-page">
      <header className="settings-header">
        <p>ASS</p>
        <h1>Settings</h1>
      </header>

      <section className="settings-identity" aria-label="Profile">
        <div className="settings-avatar" aria-hidden="true">{initials}</div>
        <div>
          <strong>{profile.displayName || "Your profile"}</strong>
          <span>{user?.email ?? "Local account"}</span>
        </div>
      </section>

      <section className="settings-section">
        <h2>Personal</h2>
        <div className="settings-group">
          <label className="settings-field">
            <span><UserRound size={19} aria-hidden="true" />Name</span>
            <input
              value={profile.displayName}
              onChange={(event) => updateProfile({ displayName: event.target.value })}
              placeholder="Display name"
            />
          </label>
          <label className="settings-field">
            <span>Email</span>
            <input
              type="email"
              value={profile.primaryEmail}
              onChange={(event) => updateProfile({ primaryEmail: event.target.value })}
              placeholder={user?.email ?? "Primary email"}
            />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h2>Sync</h2>
        <div className="settings-group">
          <div className="settings-row">
            <Cloud size={20} aria-hidden="true" />
            <div>
              <strong>ASS Cloud</strong>
              <span>
                {!configured
                  ? "Setup incomplete"
                  : user
                    ? syncStatus
                    : "Sign in to sync across devices"}
              </span>
            </div>
            <Link href="/login" aria-label={user ? "Change account" : "Sign in"}>
              {user ? "Account" : "Sign in"}<ChevronRight size={17} />
            </Link>
          </div>
          <div className="settings-row settings-row--calendar">
            <CalendarDays size={20} aria-hidden="true" />
            <CalendarSyncIndicator
              status={calendarSync.status}
              loading={calendarSync.loading}
              onSync={() => void calendarSync.syncNow()}
              onConnect={() => void calendarSync.connect()}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>Developer</h2>
        <div className="settings-group">
          <div className="settings-row settings-row--fields">
            <Github size={20} aria-hidden="true" />
            <div>
              <strong>GitHub target</strong>
              <div className="settings-inline-fields">
                <input
                  value={profile.githubUsername}
                  onChange={(event) =>
                    updateProfile({ githubUsername: event.target.value })
                  }
                  placeholder="Username"
                  aria-label="GitHub username"
                />
                <input
                  value={profile.githubRepo}
                  onChange={(event) => updateProfile({ githubRepo: event.target.value })}
                  placeholder="owner/repository"
                  aria-label="GitHub repository"
                />
              </div>
            </div>
          </div>
          <Link href="/analytics" className="settings-row settings-row--link">
            <BarChart3 size={20} aria-hidden="true" />
            <div><strong>Analytics</strong><span>Review activity and trends</span></div>
            <ChevronRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>

      {user ? (
        <button className="settings-signout" type="button" onClick={() => void signOut()}>
          <LogOut size={18} aria-hidden="true" />Sign out
        </button>
      ) : null}
    </main>
  );
}
