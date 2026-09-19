# Local-model improvement pipeline acceptance criteria

This pass is offline-first. It must not call Gemini, launch an expensive fine-tune, or replace the active Ollama model.

- Training examples remain consent-gated, owner-scoped, canonical by stable source identity, redacted, and eligible only above a configurable trust threshold.
- Dataset versions are content-addressed and immutable. Splits are deterministic by source identity, and golden benchmark hashes are excluded from training.
- Local predictions have low trust and cannot become approved ground truth without an independent trusted source.
- The permanent `ass-golden-eval` benchmark preserves the measured Gemma 4B baseline of 6/12.
- Evaluation reports accuracy, precision/recall/F1, critical false-positive rates, malformed output, latency, weighted score, and confidence calibration.
- Candidate promotion requires every configured quality gate and explicit human approval. Auto-promotion defaults off.
- Ollama packaging creates a versioned Modelfile/command; it never overwrites production implicitly.
- Deployment history supports rollback to an already packaged model without rebuilding it.
- Shadow predictions are audit-only and cannot cause actions.
- Per-task permissions keep high-risk deadline, scheduling, finance, and tool execution local handling disabled by default.
- Training, conversion, evaluation, or packaging failure leaves the current production model unchanged.
- Offline unit/integration tests, TypeScript, lint, build, database advisors, and a transactional schema self-test pass.
