-- Idempotent, coalescing Gmail push ingestion with auth-expiration filtering.
create or replace function public.enqueue_gmail_push(p_email text, p_history_id text, p_notification_id text, p_request_id text default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare
  a record;
  n integer := 0;
  updated_count integer;
begin
  if p_history_id !~ '^[0-9]{1,30}$' or p_history_id::numeric <= 0 then
    raise exception 'Invalid history ID';
  end if;
  if p_request_id is not null and length(p_request_id) > 200 then
    raise exception 'Invalid request ID';
  end if;

  for a in
    select id, user_id, gmail_history_id
    from public.google_tokens
    where lower(connected_email) = lower(p_email)
      and disconnected_at is null
      and coalesce(email_sync_status, '') != 'auth_expired'
      and coalesce(last_sync_status, '') != 'auth_expired'
  loop
    -- Always update last successful push timestamp for observability
    insert into public.gmail_watch_state(google_account_id, user_id, last_successful_push)
    values (a.id, a.user_id, now())
    on conflict(google_account_id) do update
      set last_successful_push = now(), updated_at = now();

    -- Monotonic check: only process if incoming historyId > current cursor
    if a.gmail_history_id is null or a.gmail_history_id::numeric < p_history_id::numeric then
      -- Coalesce into existing pending job if present (at most 1 pending job per account)
      update public.gmail_processing_queue
      set history_id = greatest(history_id, p_history_id::numeric),
          notification_id = p_notification_id,
          intake_request_id = coalesce(p_request_id, intake_request_id),
          next_attempt_at = least(next_attempt_at, now())
      where google_account_id = a.id and status in ('queued', 'retry_wait');

      get diagnostics updated_count = row_count;

      if updated_count = 0 then
        insert into public.gmail_processing_queue(user_id, google_account_id, history_id, notification_id, intake_request_id)
        values (a.user_id, a.id, p_history_id::numeric, p_notification_id, p_request_id)
        on conflict(google_account_id, history_id) do update
          set intake_request_id = coalesce(excluded.intake_request_id, public.gmail_processing_queue.intake_request_id),
              notification_id = excluded.notification_id;
      end if;
    end if;

    n := n + 1;
  end loop;

  return n;
end $$;

-- 3-parameter overload for backwards compatibility with un-migrated callers
create or replace function public.enqueue_gmail_push(p_email text, p_history_id text, p_notification_id text)
returns integer language plpgsql security invoker set search_path='' as $$
begin
  return public.enqueue_gmail_push(p_email, p_history_id, p_notification_id, null);
end $$;

revoke all on function public.enqueue_gmail_push(text, text, text, text), public.enqueue_gmail_push(text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_gmail_push(text, text, text, text), public.enqueue_gmail_push(text, text, text) to service_role;
