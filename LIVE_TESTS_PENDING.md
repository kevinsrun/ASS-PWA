# Live tests pending quota recovery

Do not run these while Gemini quota is exhausted. Deterministic queue, consent, retention and failure tests do not belong on this list and must pass offline.

Run only this focused sequence after quota recovers, stopping on the first provider or persistence failure:

1. One Gmail deadline message; verify classification, task/deadline persistence and completed queue job.
2. One direct response-needed message; verify a reviewable draft is persisted but not sent.
3. One optional event message; verify no confirmed calendar event is created.
4. One representative syllabus analysis with grounded structured output.
5. One multi-tool chat request with read-only tools before any mutation approval.
6. One forced retry using a controlled provider failure, then a successful retry after cooldown.

Also validate real Gemini structured output, key rotation after quota recovery, and one high-reasoning syllabus extraction. Do not bulk replay the mailbox. Record provider model/version, request IDs, job IDs, object IDs and observed quota cost.
