-- Safe consolidation of any duplicate pending rows before applying partial unique index
do $$
declare
  dup record;
begin
  -- Consolidate duplicate queued/retry_wait rows by account: advance the survivor to max(history_id)
  for dup in
    select google_account_id, max(history_id) as max_hid, min(id::text) as keep_id
    from public.gmail_processing_queue
    where status in ('queued', 'retry_wait')
    group by google_account_id
    having count(*) > 1
  loop
    update public.gmail_processing_queue
    set history_id = dup.max_hid
    where id = dup.keep_id::uuid;

    delete from public.gmail_processing_queue
    where google_account_id = dup.google_account_id
      and status in ('queued', 'retry_wait')
      and id <> dup.keep_id::uuid;
  end loop;
end $$;

-- Enforce the invariant at the database level:
-- At most ONE pending/retry_wait job may exist per Google account at any time.
create unique index if not exists gmail_queue_one_pending_per_account
on public.gmail_processing_queue (google_account_id)
where status in ('queued', 'retry_wait');

-- Clean up any ambiguous 3-parameter overload
drop function if exists public.enqueue_gmail_push(text, text, text);

-- Version 2: Unambiguous versioned RPC returning structured disposition
create or replace function public.enqueue_gmail_push_v2(
  p_email text,
  p_history_id text,
  p_notification_id text,
  p_request_id text default null
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  a record;
  v_disposition text := 'no_account';
  v_account_id uuid;
  v_user_id uuid;
  v_matched boolean := false;
  v_pending record;
begin
  if p_history_id !~ '^[0-9]{1,30}$' or p_history_id::numeric <= 0 then
    raise exception 'Invalid history ID';
  end if;
  if p_request_id is not null and length(p_request_id) > 200 then
    raise exception 'Invalid request ID';
  end if;

  -- Lock the account row to serialize concurrent push intake for the same identity
  for a in
    select id, user_id, gmail_history_id, email_sync_status, last_sync_status
    from public.google_tokens
    where lower(connected_email) = lower(p_email)
      and disconnected_at is null
    for update
  loop
    v_matched := true;
    v_account_id := a.id;
    v_user_id := a.user_id;

    -- If account auth is expired/revoked, record disposition and halt
    if coalesce(a.email_sync_status, '') = 'auth_expired' or coalesce(a.last_sync_status, '') = 'auth_expired' then
      v_disposition := 'auth_expired';
      exit;
    end if;

    -- Always update last successful push timestamp for observability
    insert into public.gmail_watch_state(google_account_id, user_id, last_successful_push)
    values (a.id, a.user_id, now())
    on conflict(google_account_id) do update
      set last_successful_push = now(), updated_at = now();

    -- Monotonic check against already processed history cursor
    if a.gmail_history_id is not null and a.gmail_history_id ~ '^[0-9]+$' and p_history_id::numeric <= a.gmail_history_id::numeric then
      v_disposition := 'stale';
      exit;
    end if;

    -- Lock and check for existing pending row (queued or retry_wait)
    select id, history_id into v_pending
    from public.gmail_processing_queue
    where google_account_id = a.id and status in ('queued', 'retry_wait')
    for update;

    if found then
      -- Coalesce to newest cursor
      if p_history_id::numeric <= v_pending.history_id then
        v_disposition := 'coalesced';
      else
        update public.gmail_processing_queue
        set history_id = p_history_id::numeric,
            notification_id = p_notification_id,
            intake_request_id = coalesce(p_request_id, intake_request_id),
            next_attempt_at = least(next_attempt_at, now())
        where id = v_pending.id;
        v_disposition := 'coalesced';
      end if;
    else
      -- Atomically insert, guarded by partial unique index
      insert into public.gmail_processing_queue(
        user_id, google_account_id, history_id, notification_id, intake_request_id, status
      ) values (
        a.user_id, a.id, p_history_id::numeric, p_notification_id, p_request_id, 'queued'
      )
      on conflict (google_account_id) where status in ('queued', 'retry_wait')
      do update set
        history_id = greatest(public.gmail_processing_queue.history_id, excluded.history_id),
        notification_id = excluded.notification_id,
        intake_request_id = coalesce(excluded.intake_request_id, public.gmail_processing_queue.intake_request_id),
        next_attempt_at = least(public.gmail_processing_queue.next_attempt_at, now());

      v_disposition := 'inserted';
    end if;

    exit; -- Handled primary matching account
  end loop;

  if not v_matched then
    v_disposition := 'no_account';
  end if;

  return jsonb_build_object(
    'disposition', v_disposition,
    'account_id', v_account_id,
    'user_id', v_user_id,
    'history_id', p_history_id
  );
end $$;

-- Legacy fallback RPC for backward compatibility with un-migrated code
create or replace function public.enqueue_gmail_push(
  p_email text,
  p_history_id text,
  p_notification_id text,
  p_request_id text default null
)
returns integer language plpgsql security invoker set search_path='' as $$
declare
  v_res jsonb;
begin
  v_res := public.enqueue_gmail_push_v2(p_email, p_history_id, p_notification_id, p_request_id);
  if (v_res->>'disposition') in ('inserted', 'coalesced') then
    return 1;
  else
    return 0;
  end if;
end $$;

revoke all on function public.enqueue_gmail_push_v2(text, text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_gmail_push_v2(text, text, text, text) to service_role;

revoke all on function public.enqueue_gmail_push(text, text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_gmail_push(text, text, text, text) to service_role;
