# Autonomous engineering workflow

ASS engineering tasks follow: objective → acceptance criteria → inspect → plan → edit → test → inspect failures → repair → re-test → diff/report. The agent stops only when acceptance criteria pass or a concrete external prerequisite is documented.

Standard tool surface: `repo.search` (`rg`), `repo.read`, `repo.edit` (`apply_patch`), `shell.run`, `tests.run`, `lint.run`, `db.migrate`, `git.diff`, and `browser.inspect`. Changes stay reviewable, preserve unrelated work, avoid destructive commands, and never use production user data as an implicit fixture.

For intelligence work, deterministic code and fixtures are authoritative where possible. `AI_PROVIDER=mock` injects success, 429, 503, timeout, invalid JSON, confidence and unavailable scenarios. Ollama is optional and cannot be required for CI. `AI_PROVIDER=router` remains the production mode. Live Gemini validation is bounded by `LIVE_TESTS_PENDING.md`.

Every delivery report distinguishes mocked, local, database, browser and live-provider evidence. Model success is not job success: required database objects and the queue completion transition must both persist.
