-- The canonical projection upserts on this exact composite key. Keep the FK
-- helper index separate so advisor changes cannot remove application identity.
drop index if exists public.plans_canonical_event_idx;
create unique index plans_canonical_event_idx
  on public.plans(user_id, canonical_event_id);
create index if not exists plans_canonical_event_fk_idx
  on public.plans(canonical_event_id);
