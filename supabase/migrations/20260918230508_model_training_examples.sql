create table public.model_training_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.model_training_examples (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 task_type text not null,
 input_text text not null,
 context_json jsonb not null default '{}',
 model_prediction jsonb,
 model_confidence double precision check (model_confidence between 0 and 1),
 final_label jsonb not null,
 correction_source text not null check (correction_source in ('USER_CORRECTION','DETERMINISTIC_VALIDATION','GEMINI_VERIFIED','SYSTEM_VERIFIED','GEMINI_PSEUDO_LABEL')),
 quality text not null default 'needs_review' check (quality in ('needs_review','approved','rejected')),
 source_key text not null,
 created_at timestamptz not null default now(),
 unique(user_id,source_key)
);
create index model_training_examples_owner_date on public.model_training_examples(user_id,created_at,id);
alter table public.model_training_examples enable row level security;
alter table public.model_training_preferences enable row level security;
revoke all on public.model_training_examples, public.model_training_preferences from anon, authenticated;
grant all on public.model_training_examples, public.model_training_preferences to service_role;
