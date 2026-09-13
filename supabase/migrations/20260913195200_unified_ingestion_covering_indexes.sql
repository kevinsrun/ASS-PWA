-- Cover foreign keys used by the unified calendar and draft pipelines.
create index if not exists email_drafts_user_idx on public.email_drafts(user_id);
create index if not exists plans_canonical_event_idx on public.plans(canonical_event_id) where canonical_event_id is not null;
