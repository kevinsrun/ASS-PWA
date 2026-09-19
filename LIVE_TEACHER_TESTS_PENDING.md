# Live teacher tests pending

Gemini teacher mode remains disabled. After quota resets, enable it deliberately for a bounded validation session only.

1. Review one user-corrected deadline example and verify evidence grounding.
2. Compare one local/Gemini disagreement without automatically approving either output.
3. Generate at most three hard cases, mark them synthetic, and run the deterministic critic.
4. Confirm quota, request IDs, redaction, and failure handling are recorded.
5. Disable the teacher again before any bulk dataset operation.

Teacher output alone remains pseudo-label data (`STRONG_MODEL_PSEUDO_LABEL`, trust 0.80) until independently reviewed.
