"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setMessage("");

    const error =
      mode === "signin"
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password);

    setLoading(false);

    if (error) {
      setMessage(error);
      return;
    }

    setMessage(
      mode === "signup"
        ? "Account created. Check your email if confirmation is enabled."
        : "Signed in."
    );
    router.push("/profile");
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-3xl font-bold text-emerald-950">ASS Login</h1>
      <p className="mt-2 text-slate-600">
        Sign in to sync your schedule system with Supabase.
      </p>

      <section className="ios-card mt-6 rounded-3xl p-5">
        {!configured && (
          <div className="mb-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
            Supabase environment variables are missing. Local mode still works.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {(["signin", "signup"] as const).map((item) => (
            <button
              key={item}
              onClick={() => setMode(item)}
              className={`min-h-11 rounded-xl text-sm font-medium ${
                mode === item
                  ? "bg-emerald-600 text-white"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {item === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            className="min-h-12 rounded-xl border border-emerald-100 px-4"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
            className="min-h-12 rounded-xl border border-emerald-100 px-4"
          />
          <button
            onClick={submit}
            disabled={!configured || loading || !email || !password}
            className="min-h-12 rounded-xl bg-emerald-600 px-4 text-white disabled:opacity-50"
          >
            {loading ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </div>

        {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
      </section>
    </main>
  );
}
