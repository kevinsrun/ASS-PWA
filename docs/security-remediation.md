# Security and dependency remediation checklist

- Supabase Dashboard → Authentication → Sign In / Providers → Password security: enable leaked-password protection. This is a manual dashboard control and remains incomplete until the advisor no longer reports `auth_leaked_password_protection`.
- Keep `SUPABASE_SECRET_KEY`/legacy service-role keys server-only; never add a `NEXT_PUBLIC_` variant.
- Production and full dependency audits report zero vulnerabilities after compatible transitive lockfile updates. See `docs/dependency-audit.md`.
- Configure an external error tracker or Vercel Drain when a destination and plan are selected. Runtime structured logs and the protected health endpoint are the current baseline; no external drain is claimed.
- Supabase reports `RLS enabled, no policy` for several server-only tables, including training revisions/purge logs and provider cooldowns. This is intentional deny-by-default behavior: `anon` and `authenticated` have no table privileges, while server code uses `service_role`. Do not add client policies merely to silence the informational advisor.
