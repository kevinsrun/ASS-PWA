"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { configured, signIn, signUp, signInWithGoogle } = useAuth();
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

  async function google() {
    setLoading(true); setMessage("");
    const error = await signInWithGoogle();
    if (error) { setMessage(`Google sign-in failed: ${error}`); setLoading(false); }
  }

  return (
    <main className="auth-page">
      <header className="auth-header">
        <span>ASS</span>
        <h1>{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
        <p>Your schedule, quietly in sync.</p>
      </header>

      <section className="auth-card">
        {!configured && (
          <div className="ass-inline-error mb-4">
            Supabase environment variables are missing. Local mode still works.
          </div>
        )}

        <button type="button" className="google-auth-button" disabled={!configured || loading} onClick={google}>
          <span aria-hidden="true">G</span>{loading ? "Connecting…" : "Continue with Google"}
        </button>
        <div className="auth-divider"><span>or</span></div>

        <div className="ass-segmented">
          {(["signin", "signup"] as const).map((item) => (
            <button
              key={item}
              onClick={() => setMode(item)}
              className={mode === item ? "is-active" : ""}
            >
              {item === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <div className="auth-fields">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            className="ass-input"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
            className="ass-input"
          />
          <button
            onClick={submit}
            disabled={!configured || loading || !email || !password}
            className="ass-primary-button"
          >
            {loading ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </div>

        {message && <p className="auth-message">{message}</p>}
      </section>
    </main>
  );
}
