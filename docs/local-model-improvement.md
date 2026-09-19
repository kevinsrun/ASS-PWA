# Autonomous local-model improvement pipeline

ASS now separates labeling, criticism, curation, training, evaluation, promotion, and rollback. Production inference remains unchanged until a versioned candidate passes the golden benchmark and receives explicit human approval. `AUTO_MODEL_PROMOTION=false`, `TEACHER_PROVIDER=mock`, and `LOCAL_TRAINING_ENABLED=false` are the safe defaults.

## Trust and privacy

Trust order is `USER_CORRECTION` / `DETERMINISTIC_VERIFIED` (1.00), `STRONG_MODEL_REVIEWED` (0.95), `STRONG_MODEL_PSEUDO_LABEL` (0.80), `LOCAL_MODEL_REVIEWED` (0.60), and `LOCAL_MODEL_PREDICTION` (0.20). The default exporter threshold is 0.80, but rows must also be active, owner-approved, critic-eligible, non-sensitive, canonical, and outside the golden benchmark. A local model prediction can never approve itself.

Collection still requires atomically locked user consent. Training deletion invalidates every sealed dataset that referenced the deleted row. Future runs reject invalidated datasets. Dataset artifacts must be stored on an encrypted owner-controlled disk and removed when their registry version is invalidated.

## Commands

```bash
# Build and register an owner-scoped immutable dataset
npm run ai:dataset:build -- --user-id USER_UUID --version 1

# Validate counts, split isolation, identities and secret redaction
npm run ai:dataset:validate -- --dataset artifacts/ai/datasets/ass-dataset-v1-HASH

# Create a run manifest only (default); add --execute after configuring a training node
npm run ai:train -- --dataset DATASET_DIR --dataset-id DATASET_UUID --user-id USER_UUID
npm run ai:train -- --dataset DATASET_DIR --dataset-id DATASET_UUID --user-id USER_UUID --execute --version 2 --tag ass-local-v2-candidate

# Score model-produced JSONL predictions against the permanent held-out benchmark
npm run ai:eval -- --predictions predictions.jsonl --model ass-local-v2-candidate --output eval-v2.json

# Generate a versioned Ollama Modelfile; add --execute only after reviewing it
npm run ai:package -- --base BASE_OLLAMA_TAG --adapter ADAPTER_PATH --tag ass-local-v2-candidate

# Inspect registry, test promotion gates, explicitly approve, or rollback
npm run ai:candidate:list
npm run ai:promote -- --candidate eval-v2.json --current eval-v1.json
HUMAN_MODEL_PROMOTION_APPROVED=true npm run ai:promote -- --candidate eval-v2.json --current eval-v1.json --apply --candidate-id UUID --user-id UUID --tag ass-local-v2-candidate --execute-ollama
npm run ai:rollback -- --tag ass-local-v1
HUMAN_MODEL_PROMOTION_APPROVED=true npm run ai:rollback -- --apply --deployment-id UUID --user-id UUID --tag ass-local-v1 --execute-ollama
```

`ass-local-production` is the stable Ollama alias. Promotion and rollback copy an already packaged version to that alias before calling an atomic registry transaction. If the registry transaction fails, the command compensates by restoring the prior alias (or removes a first-time alias). Keep `OLLAMA_MODEL=ass-local-production` where local inference runs.

## Training backend

The Python worker supports LoRA on compatible CPU/MPS/CUDA environments and QLoRA on a supported CUDA node. Its optional stack is PyTorch, Transformers, Datasets, PEFT, Accelerate, TRL-compatible tooling, and bitsandbytes for QLoRA. Install these in an isolated environment appropriate to the training hardware; they are deliberately not application runtime dependencies.

Every run records the base model, immutable dataset hash/version, counts, method, epochs, learning rate, detected hardware, git commit, timestamps, status, logs/artifact location, and any bounded error. A failed run never changes the production alias.

## Evaluation and routing

`ass-golden-eval` v1 permanently preserves 12 held-out cases and the historical Gemma 4B result of 6/12. Evaluation reports overall and weighted accuracy, per-class precision/recall/F1, false calendar events, deadline/response/required-optional accuracy, malformed output, latency, confidence calibration buckets, and throughput/memory when the prediction runner supplies them.

Promotion requires non-regressing overall accuracy, strictly improved weighted score, non-regressing false-event and malformed rates, minimum critical-class recall, and bounded latency. Per-task routing is separately controlled through `LOCAL_MODEL_TASKS`; high-risk deadline, finance, complex scheduling, and destructive tool work remain disabled by default.

Shadow records compare candidate and production outputs but return no actionable result. Hard-example records prioritize uncertainty, disagreements, corrections, deterministic rejection, malformed output, and repeated error categories for later curation.

The autonomous coding workflow may inspect evaluation reports, improve deterministic rules/prompts, add benchmark cases, and rerun candidates. It may not change the production alias without passing gates and explicit approval.
