# Shared intelligence architecture — phases 1–2

`src/lib/ai/router.ts` owns routing policy and provider escalation. Existing domain services remain authoritative for overlap, permissions, normalization, IDs, and validation. The router requires an explicit deterministic resolver and never sends those tasks to a model. Web and future authenticated mobile routes call the same server services.

`src/lib/ai/ollama.ts` uses Ollama's native structured-output API. Gemini retains the existing SDK and batched classifier. No second agent/tool execution implementation is introduced. Gemini MEDIUM currently means the existing high-thinking reasoning model; it is a policy tier, not an unsupported provider setting.

The first consumer is Gmail triage. Mailbox state and narrow exact retail rules stay deterministic. A mailing-list header alone no longer proves an email irrelevant. Opted-in local inference can accept only evidence-grounded generic newsletters/promotions with confidence ≥ .97. Institutional mail, tasks, deadlines, meetings, finances, security, opportunities, and ambiguous results continue to Gemini. Local predictions cannot create calendar events, send email, or submit forms. Existing validated downstream workflows and user automation permissions still apply.

## Local setup

Ollama 0.34.2 is reachable on the development Mac (24 GiB RAM). Three candidate tags are installed and tested; none is selected as an automatic default. For another development machine, install Ollama from its official source, then:

```sh
ollama serve
ollama pull gemma3:1b
```

Configure server-side development variables (never NEXT_PUBLIC):

```dotenv
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:1b
```

`gemma3:1b` is a candidate, not a benchmark winner. The published tag is a small Q4_K_M model (~815 MB model file); runtime memory is additional. Measure warm/cold latency, resident memory, precision/recall/F1, extraction accuracy, event false positives, and escalation rate against held-out examples. Self-reported confidence is not calibrated accuracy. Until a model passes quality gates, leave OLLAMA_ENABLED unset/false.

### Live synthetic smoke evaluation (2026-09-18)

Run the actual provider and production triage prompt, without real user data:

```sh
OLLAMA_ENABLED=true node scripts/benchmark-local-triage.mjs gemma3:270m gemma3:1b gemma3:4b
```

| Candidate | Correct / 12 | Evidence accuracy | Cold latency | Mean warm latency | Loaded model bytes | Escalation |
|---|---:|---:|---:|---:|---:|---:|
| gemma3:270m | 2 | 58.3% | 881 ms | 200 ms | 324,523,785 | 100% |
| gemma3:1b | 1 | 16.7% | 1,401 ms | 537 ms | 887,797,841 | 100% |
| gemma3:4b | 6 | 66.7% | 2,979 ms | 1,321 ms | 3,725,527,612 | 100% |

No false-positive events occurred in these twelve synthetic cases. Loaded model memory is Ollama's reported allocation, not measured process RSS. All predictions escalated; no measured Gemini call reduction. 4B is the strongest tested candidate but still misclassified required forms, replies, and deadlines. Do not enable it by default based on this tiny suite. Prompt improvements and a larger held-out precision/recall evaluation are still required. Earlier exploratory prompt runs are not included in this comparison.

The provider has a 12-second timeout, bounded context/output, strict evidence checks, and no automatic model download. Unavailable/invalid local output returns the message to the existing Gemini batch. If Gemini also fails, the existing durable Gmail cursor/error path retains work for retry. Quota exhaustion never justifies lowering the confidence gate.

## Production and mobile

Vercel localhost is not the development Mac. Keep local inference disabled there unless an explicitly configured trusted HTTPS Ollama service is reachable. Do not publicly expose an unauthenticated Ollama port. This adapter does not yet implement authenticated remote hosting; deployment needs a reviewed private/authenticated service design. The iPhone will call ASS backend APIs, not localhost Ollama.

## Remaining phased work

3. Implemented: owner-isolated persistent cache for completed document analysis and accepted local email triage; content/task/model/prompt/analysis versions in keys. Document cache also fingerprints correction/rule/course context and the analysis day. Failed/unknown/escalated results are never cached. Explicit document/email re-analysis bypasses cached results. Cache expiry is seven days (logical validity, not an automatic physical-retention cleanup job). Existing Gmail processed-source storage still prevents normal reclassification. Usage records track actual attempts, including fallbacks, in document and Gmail-classification scopes. Profile → AI Usage shows UTC-day counters and explicitly excludes uninstrumented chat/agent calls. Cache reuse is shown rather than inventing token/cost or batched Gemini call savings. No historical counters are fabricated. Cross-instance duplicate upload analysis is still governed by existing source leases; this cache does not introduce a new distributed lock.
4. Consent-aware corrections/training example collection, quality filters and JSONL export. User corrections outrank verified and pseudo labels; never live-train Ollama.
5–6. Shared PDF services/templates and Adobe adapter with server-side credentials and basic PDF fallback.
7–10. Native SwiftUI authentication/skeleton, shared mobile APIs/screens, QR/forms preview/approval, APNs. Core processing stays server-side.

These later phases are not implemented by this commit. Native iOS, PDF output, durable usage metrics, training exports, and Gemini request reductions have not been claimed as verified.

Primary references: [Ollama Generate API](https://docs.ollama.com/api/generate), [Gemma 3 1B tag](https://ollama.com/library/gemma3:1b).
