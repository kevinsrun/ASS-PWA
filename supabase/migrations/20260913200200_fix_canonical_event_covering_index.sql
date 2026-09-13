-- PostgreSQL's FK advisor requires a full covering index, not a partial one.
drop index if exists public.plans_canonical_event_idx;
create index plans_canonical_event_idx on public.plans(canonical_event_id);
