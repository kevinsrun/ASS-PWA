create index if not exists academic_recurring_events_canonical_idx
  on public.academic_recurring_events(canonical_event_id);
create index if not exists academic_recurring_events_extraction_idx
  on public.academic_recurring_events(extraction_item_id)
  where extraction_item_id is not null;
