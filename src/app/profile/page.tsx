"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Github, Mail, BarChart3 } from "lucide-react";
import { useAppContext } from "@/providers/AppProvider";
import { useAuth } from "@/providers/AuthProvider";

export default function ProfilePage() {
  const { profile, syncStatus, updateProfile } = useAppContext();
  const { configured, user, signOut } = useAuth();
  const [googleStatus, setGoogleStatus] = useState<{
    connected: boolean;
    clientConfigured: boolean;
    redirectUri: string;
  } | null>(null);

  const githubReady = Boolean(profile.githubUsername && profile.githubRepo);

  useEffect(() => {
    fetch("/api/auth/google/status")
      .then((response) => response.json())
      .then(setGoogleStatus)
      .catch(() => setGoogleStatus(null));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold text-emerald-950">Profile</h1>
      <p className="mt-2 text-slate-600">
        Account connections, personal defaults, and automation settings.
      </p>

      <section className="ios-card mt-6 rounded-3xl p-5">
        <h2 className="text-xl font-semibold text-emerald-950">Cloud Account</h2>
        <p className="mt-2 text-sm text-slate-600">
          Supabase controls cloud sync. Local storage remains a cache.
        </p>
        <div className="mt-3 rounded-xl bg-white/80 p-3 text-sm text-slate-600">
          <div>Supabase configured: {configured ? "Yes" : "No"}</div>
          <div>Signed in: {user?.email ?? "No"}</div>
          <div>Sync status: {syncStatus}</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/login"
            className="flex min-h-11 items-center rounded-xl bg-emerald-600 px-4 text-white"
          >
            {user ? "Switch account" : "Login / Signup"}
          </Link>
          {user && (
            <button
              onClick={signOut}
              className="min-h-11 rounded-xl border border-slate-200 px-4 text-slate-700"
            >
              Sign out
            </button>
          )}
        </div>
      </section>

      <section className="ios-card mt-5 rounded-3xl p-5">
        <h2 className="text-xl font-semibold text-emerald-950">You</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            value={profile.displayName}
            onChange={(event) => updateProfile({ displayName: event.target.value })}
            placeholder="Display name"
            className="min-h-12 rounded-xl border border-emerald-100 px-4"
          />
          <input
            value={profile.primaryEmail}
            onChange={(event) => updateProfile({ primaryEmail: event.target.value })}
            placeholder="Primary email"
            className="min-h-12 rounded-xl border border-emerald-100 px-4"
          />
        </div>
      </section>

      <section className="ios-card mt-5 rounded-3xl p-5">
        <div className="flex items-center gap-2">
          <Github className="text-gray-900" size={20} />
          <h2 className="text-xl font-semibold text-emerald-950">GitHub</h2>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          ASS uses this repo for review-gated overnight coding workflows. OAuth can be added later; for now this saves the repo target used by the local runner.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            value={profile.githubUsername}
            onChange={(event) =>
              updateProfile({
                githubUsername: event.target.value,
                githubConnected: Boolean(event.target.value && profile.githubRepo),
              })
            }
            placeholder="GitHub username"
            className="min-h-12 rounded-xl border border-emerald-100 px-4"
          />
          <input
            value={profile.githubRepo}
            onChange={(event) =>
              updateProfile({
                githubRepo: event.target.value,
                githubConnected: Boolean(profile.githubUsername && event.target.value),
              })
            }
            placeholder="Repo, e.g. kevin/ass-pwa"
            className="min-h-12 rounded-xl border border-emerald-100 px-4"
          />
        </div>
        <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
          Status: {githubReady ? "GitHub target saved" : "Add username and repo"}
        </div>
      </section>

      <section className="ios-card mt-5 rounded-3xl p-5">
        <div className="flex items-center gap-2">
          <Mail className="text-emerald-600" size={20} />
          <h2 className="text-xl font-semibold text-emerald-950">Email & Calendar</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <a
            href="/api/auth/google"
            className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-600 px-4 text-white"
          >
            Connect Gmail / Google Calendar
          </a>
          <button
            disabled
            className="min-h-12 rounded-xl border border-slate-200 px-4 text-slate-400"
          >
            Outlook later
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          If Google says the app is in testing, add your Gmail as a test user in Google Cloud OAuth consent screen and make sure the redirect URI exactly matches your `.env.local` value.
        </p>
        <div className="mt-3 rounded-xl bg-white/80 p-3 text-sm text-slate-600">
          <div>Google status: {googleStatus?.connected ? "Connected" : "Not connected"}</div>
          <div>Client configured: {googleStatus?.clientConfigured ? "Yes" : "No"}</div>
          <div className="break-all">Redirect URI: {googleStatus?.redirectUri || "Missing"}</div>
        </div>
      </section>

      <section className="ios-card mt-5 rounded-3xl p-5">
        <h2 className="text-xl font-semibold text-emerald-950">Vercel Cron</h2>
        <p className="mt-2 text-sm text-slate-600">
          ASS uses two daily Vercel cron jobs: morning scan and evening review.
          Schedules are stored in `vercel.json` and run in UTC.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <a
            href="/api/cron/morning"
            className="flex min-h-12 items-center justify-center rounded-xl border border-emerald-100 bg-white px-4 text-emerald-700"
          >
            Test Morning Cron
          </a>
          <a
            href="/api/cron/evening"
            className="flex min-h-12 items-center justify-center rounded-xl border border-blue-100 bg-white px-4 text-blue-700"
          >
            Test Evening Cron
          </a>
        </div>
      </section>

      <Link
        href="/analytics"
        className="ios-card mt-5 flex items-center gap-3 rounded-3xl p-5 text-emerald-800"
      >
        <BarChart3 size={20} />
        Open Analytics
      </Link>
    </main>
  );
}
