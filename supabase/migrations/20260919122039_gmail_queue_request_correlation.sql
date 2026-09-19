alter table public.gmail_processing_queue add column intake_request_id text;

create function public.enqueue_gmail_push(p_email text,p_history_id text,p_notification_id text,p_request_id text)
returns integer language plpgsql security invoker set search_path='' as $$
declare a record; n integer:=0;
begin
 if p_history_id !~ '^[0-9]{1,30}$' or p_history_id::numeric<=0 then raise exception 'Invalid history ID'; end if;
 if length(p_request_id)>200 then raise exception 'Invalid request ID'; end if;
 for a in select id,user_id,gmail_history_id from public.google_tokens where lower(connected_email)=lower(p_email) and disconnected_at is null loop
   insert into public.gmail_watch_state(google_account_id,user_id,last_successful_push) values(a.id,a.user_id,now())
   on conflict(google_account_id) do update set last_successful_push=now(),updated_at=now();
   if a.gmail_history_id is null or a.gmail_history_id::numeric<p_history_id::numeric then
     insert into public.gmail_processing_queue(user_id,google_account_id,history_id,notification_id,intake_request_id)
     values(a.user_id,a.id,p_history_id::numeric,p_notification_id,p_request_id) on conflict(google_account_id,history_id) do nothing;
   end if;
   n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.enqueue_gmail_push(text,text,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_gmail_push(text,text,text,text) to service_role;
