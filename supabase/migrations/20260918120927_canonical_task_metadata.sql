alter table public.todos
  add column description text not null default '',
  add column status text not null default 'TODO' check (status in ('TODO','IN_PROGRESS','WAITING','COMPLETED','IGNORED')),
  add column due_at timestamptz,
  add column start_after timestamptz,
  add column source_type text,
  add column source_id text,
  add column project_id uuid,
  add column course_id uuid,
  add column google_task_id text,
  add column google_tasklist_id text,
  add column google_account_id uuid,
  add column google_synced_at timestamptz,
  add column google_sync_error text,
  add column created_at timestamptz not null default now(),
  add column completed_at timestamptz,
  add column deleted_at timestamptz;
update public.todos set status='COMPLETED', completed_at=updated_at where done;
create index todos_open_due_idx on public.todos(user_id,due_date) where deleted_at is null and not done;
alter table public.google_tokens add column tasks_enabled boolean not null default false, add column google_tasklist_id text;
create function public.align_task_completion() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='INSERT' then
    if NEW.done then NEW.status='COMPLETED'; NEW.completed_at=coalesce(NEW.completed_at,now()); end if;
  elsif NEW.done is distinct from OLD.done then
    NEW.status=case when NEW.done then 'COMPLETED' else 'TODO' end;
    NEW.completed_at=case when NEW.done then now() else null end;
  elsif NEW.status is distinct from OLD.status then
    NEW.done=NEW.status='COMPLETED';
    NEW.completed_at=case when NEW.done then now() else null end;
  end if;
  return NEW;
end $$;
revoke all on function public.align_task_completion() from public, anon, authenticated;
create trigger align_task_completion before insert or update on public.todos for each row execute function public.align_task_completion();
