# Training data and local-model improvement

Profile → AI Usage → `/debug/training` manages owner-scoped correction data. Collection is disabled by default and enforced atomically in Postgres. Only explicit corrections from authenticated email/file review flows are eligible; generated drafts and RSVP decisions are excluded.

Examples use stable owner/source/task identity, retain revision history, and expose one active canonical correction. Disabling collection blocks future writes. Owners can delete individual or all examples and choose 30, 90, 180, 365 days, or forever retention. Scheduled purges log counts without source text. Deleting a row invalidates sealed datasets that referenced it.

Approval does not automatically make an example trainable. The curator also requires sufficient trust, critic eligibility, non-sensitive content, valid identity/output, no superseded correction, and no golden-benchmark contamination. Export redacts credential-like values and splits by stable source identity.

The complete versioned dataset, training, evaluation, Ollama packaging, promotion, rollback, shadow-mode, and command workflow is in `docs/local-model-improvement.md`. Gemini teacher validation remains deferred in `LIVE_TEACHER_TESTS_PENDING.md`.
