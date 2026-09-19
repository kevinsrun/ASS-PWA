#!/usr/bin/env python3
import argparse, json, os, platform, subprocess, sys, time
from pathlib import Path

def hardware():
    result={"device":platform.machine(),"platform":platform.platform(),"backend":"cpu","precision":"float32","quantization":"none"}
    try:
        import torch
        if torch.cuda.is_available(): result.update(device="cuda",backend="pytorch-cuda",gpu_name=torch.cuda.get_device_name(0),vram= torch.cuda.get_device_properties(0).total_memory,precision="bfloat16",quantization="4bit")
        elif getattr(torch.backends,"mps",None) and torch.backends.mps.is_available(): result.update(device="mps",backend="pytorch-mps",precision="float16")
    except ImportError: pass
    return result

parser=argparse.ArgumentParser(description="Versioned ASS LoRA/QLoRA training worker")
parser.add_argument("--dataset",required=True);parser.add_argument("--output",required=True);parser.add_argument("--run-id");parser.add_argument("--execute",action="store_true");parser.add_argument("--epochs",type=int,default=3);parser.add_argument("--learning-rate",type=float,default=2e-4)
opts=parser.parse_args();dataset=Path(opts.dataset).resolve();output=Path(opts.output).resolve();manifest=json.loads((dataset/"manifest.json").read_text());
if manifest.get("example_count",0)<1: raise SystemExit("Dataset is empty")
for split in ("train","validation","test"):
    if not (dataset/f"{split}.jsonl").exists(): raise SystemExit(f"Missing {split} split")
base=os.getenv("LOCAL_TRAINING_BASE_MODEL","").strip();method=os.getenv("LOCAL_TRAINING_METHOD","qlora").lower()
if method not in ("lora","qlora"): raise SystemExit("Method must be lora or qlora")
run_id=opts.run_id or f"train-{int(time.time())}-{manifest['content_hash'][:8]}"
if not all(character.isalnum() or character in "-_" for character in run_id): raise SystemExit("Run ID contains unsafe characters")
run_dir=output/run_id;run_dir.mkdir(parents=True,exist_ok=False)
run_manifest={"run_id":run_id,"base_model":base,"dataset_version":manifest["name"],"dataset_hash":manifest["content_hash"],"training_examples":manifest["counts"]["train"],"validation_examples":manifest["counts"]["validation"],"method":method,"epochs":opts.epochs,"learning_rate":opts.learning_rate,"hardware":hardware(),"git_commit":subprocess.run(["git","rev-parse","HEAD"],capture_output=True,text=True).stdout.strip(),"started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"status":"planned"}
(run_dir/"manifest.json").write_text(json.dumps(run_manifest,indent=2)+"\n")
if not opts.execute:
    print(json.dumps({"stage":"training_plan_created","run_dir":str(run_dir),"manifest":run_manifest}));raise SystemExit(0)
if os.getenv("LOCAL_TRAINING_ENABLED")!="true": raise SystemExit("Set LOCAL_TRAINING_ENABLED=true for deliberate training")
if not base: raise SystemExit("LOCAL_TRAINING_BASE_MODEL is required")
try:
    import torch
    from datasets import load_dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, DataCollatorForLanguageModeling, Trainer, TrainingArguments
except ImportError as exc: raise SystemExit(f"Install optional training dependencies in an isolated environment: {exc}")
if method=="qlora" and not torch.cuda.is_available(): raise SystemExit("QLoRA requires a supported CUDA training node; use LoRA on this machine")
quant=BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type="nf4",bnb_4bit_compute_dtype=torch.bfloat16) if method=="qlora" else None
tokenizer=AutoTokenizer.from_pretrained(base);tokenizer.pad_token=tokenizer.pad_token or tokenizer.eos_token
model=AutoModelForCausalLM.from_pretrained(base,quantization_config=quant,device_map="auto" if torch.cuda.is_available() else None)
if quant:model=prepare_model_for_kbit_training(model)
model=get_peft_model(model,LoraConfig(r=16,lora_alpha=32,lora_dropout=.05,bias="none",task_type="CAUSAL_LM",target_modules="all-linear"))
data=load_dataset("json",data_files={"train":str(dataset/"train.jsonl"),"validation":str(dataset/"validation.jsonl")})
def tokenize(row):
    text=tokenizer.apply_chat_template(row["messages"],tokenize=False,add_generation_prompt=False) if tokenizer.chat_template else "\n".join(f"{m['role']}: {m['content']}" for m in row["messages"])
    return tokenizer(text,truncation=True,max_length=2048)
tokenized=data.map(tokenize,remove_columns=data["train"].column_names)
trainer=Trainer(model=model,args=TrainingArguments(output_dir=str(run_dir/"checkpoints"),num_train_epochs=opts.epochs,learning_rate=opts.learning_rate,per_device_train_batch_size=1,gradient_accumulation_steps=8,evaluation_strategy="epoch",save_strategy="epoch",logging_steps=5,report_to=[]),train_dataset=tokenized["train"],eval_dataset=tokenized["validation"],data_collator=DataCollatorForLanguageModeling(tokenizer,mlm=False))
try:
    trainer.train();trainer.save_state();model.save_pretrained(run_dir/"adapter");tokenizer.save_pretrained(run_dir/"adapter");run_manifest.update(status="completed",completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()))
except Exception as exc:
    run_manifest.update(status="failed",completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),error=str(exc)[:1000]);raise
finally:(run_dir/"manifest.json").write_text(json.dumps(run_manifest,indent=2)+"\n")
