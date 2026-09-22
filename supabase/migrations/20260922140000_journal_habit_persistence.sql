-- Preserve existing Journal and Habit rows while adding the fields used by
-- the client model for richer habit goals and titled journal entries.
alter table public.habits
  add column if not exists target_type text not null default 'binary',
  add column if not exists target_amount numeric not null default 1,
  add column if not exists target_unit text not null default '';

alter table public.habits
  drop constraint if exists habits_target_type_check,
  add constraint habits_target_type_check
    check (target_type in ('binary', 'count', 'duration', 'frequency')),
  drop constraint if exists habits_target_amount_check,
  add constraint habits_target_amount_check
    check (target_amount > 0);

alter table public.journal_entries
  add column if not exists title text not null default '';
