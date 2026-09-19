-- Transactional migration self-test. Every touched production row is restored
-- before commit; synthetic rows are deleted. This validates the actual RPCs
-- without a model call or durable fixture data.
create temporary table _reliability_account on commit drop as select id,user_id from public.google_tokens order by id limit 1;
create temporary table _reliability_queue on commit drop as
 select id,status,completed_at,locked_at,locked_by,next_attempt_at,attempts,last_error,last_provider_status,attempt_history,started_at
 from public.gmail_processing_queue where status in ('queued','processing','retry_wait','failed','dead_letter');

do $$
declare a record; worker uuid:=gen_random_uuid(); claimed uuid; n integer; state text;
begin
 select * into a from _reliability_account;
 if not found then return; end if;
 update public.gmail_processing_queue set status='completed',completed_at=coalesce(completed_at,now()),locked_at=null,locked_by=null
 where id in(select id from _reliability_queue);
 insert into public.gmail_processing_queue(user_id,google_account_id,history_id,notification_id,intake_request_id,status,next_attempt_at)
 values(a.user_id,a.id,999999999999999999999999999999,'codex-queue-test','codex-request-test','queued',now())
 on conflict(google_account_id,history_id) do update set status='queued',next_attempt_at=now(),locked_at=null,locked_by=null;
 insert into public.gmail_processing_queue(user_id,google_account_id,history_id,notification_id,intake_request_id,status,next_attempt_at)
 values(a.user_id,a.id,999999999999999999999999999999,'codex-queue-test-duplicate','codex-request-test-duplicate','queued',now())
 on conflict(google_account_id,history_id) do nothing;
 select count(*) into n from public.gmail_processing_queue where google_account_id=a.id and history_id=999999999999999999999999999999;
 if n<>1 then raise exception 'duplicate queue insertion was not idempotent'; end if;
 select id into claimed from public.claim_gmail_processing_jobs(1,worker);
 select status into state from public.gmail_processing_queue where id=claimed;
 if state<>'processing' then raise exception 'queue claim did not transition to processing'; end if;
 perform public.finish_gmail_job_batch(a.user_id,a.id,worker,'retry_wait','Mock HTTP 429',429,now());
 select status into state from public.gmail_processing_queue where id=claimed;
 if state<>'retry_wait' then raise exception 'retry transition failed'; end if;
 update public.gmail_processing_queue set status='processing',locked_at=now()-interval '11 minutes',locked_by=gen_random_uuid(),next_attempt_at=now() where id=claimed;
 select id into claimed from public.claim_gmail_processing_jobs(1,worker);
 if claimed is null then raise exception 'stale lock was not recovered'; end if;
 perform public.finish_gmail_job_batch(a.user_id,a.id,worker,'dead_letter','Mock exhausted',503,null);
 select status into state from public.gmail_processing_queue where id=claimed;
 if state<>'dead_letter' then raise exception 'dead-letter transition failed'; end if;
 delete from public.gmail_processing_queue where google_account_id=a.id and history_id=999999999999999999999999999999;
 update public.gmail_processing_queue q set status=s.status,completed_at=s.completed_at,locked_at=s.locked_at,locked_by=s.locked_by,
  next_attempt_at=s.next_attempt_at,attempts=s.attempts,last_error=s.last_error,last_provider_status=s.last_provider_status,
  attempt_history=s.attempt_history,started_at=s.started_at from _reliability_queue s where q.id=s.id;
end $$;

create temporary table _reliability_user on commit drop as select id from auth.users order by created_at limit 1;
create temporary table _reliability_pref on commit drop as select p.* from public.model_training_preferences p join _reliability_user u on u.id=p.user_id;
create temporary table _reliability_dates on commit drop as select e.id,e.created_at from public.model_training_examples e join _reliability_user u on u.id=e.user_id;
create temporary table _reliability_purges on commit drop as select r.* from public.model_training_purge_runs r join _reliability_user u on u.id=r.user_id;

do $$
declare u uuid; v_example_id uuid; n integer; blocked boolean:=false;
begin
 select id into u from _reliability_user;
 if u is null then return; end if;
 insert into public.model_training_preferences(user_id,enabled,retention_days) values(u,true,30)
 on conflict(user_id) do update set enabled=true,retention_days=30;
 delete from public.model_training_examples where user_id=u and source_type='email' and source_id in ('codex-training-test','codex-disabled-test');
 v_example_id:=public.collect_model_training_correction(u,'email','codex-training-test','classify','fixture','{"source_type":"email"}','{"type":"REFERENCE"}',0.8,'{"type":"CALENDAR_EVENT"}');
 perform public.collect_model_training_correction(u,'email','codex-training-test','classify','fixture','{"source_type":"email"}','{"type":"CALENDAR_EVENT"}',0.9,'{"type":"TASK"}');
 select count(*) into n from public.model_training_examples where user_id=u and source_type='email' and source_id='codex-training-test' and task_type='classify' and active;
 if n<>1 then raise exception 'canonical correction identity failed'; end if;
 select count(*) into n from public.model_training_example_revisions r where r.example_id=v_example_id;
 if n<>1 then raise exception 'correction revision was not recorded'; end if;
 update public.model_training_preferences set enabled=false where user_id=u;
 begin
  perform public.collect_model_training_correction(u,'email','codex-disabled-test','classify','fixture','{}','{}',0.5,'{}');
 exception when sqlstate '42501' then blocked:=true;
 end;
 if not blocked then raise exception 'disabled consent accepted a write'; end if;
 update public.model_training_preferences set enabled=true,retention_days=30 where user_id=u;
 update public.model_training_examples set created_at=now() where user_id=u;
 update public.model_training_examples set created_at=now()-interval '31 days' where id=v_example_id;
 delete from public.model_training_purge_runs where user_id=u;
 perform public.purge_expired_model_training_examples(u);
 if exists(select 1 from public.model_training_examples where id=v_example_id) then raise exception 'retention purge did not delete expired row'; end if;
 delete from public.model_training_examples where user_id=u and source_type='email' and source_id in ('codex-training-test','codex-disabled-test');
 update public.model_training_examples e set created_at=s.created_at from _reliability_dates s where e.id=s.id;
 delete from public.model_training_purge_runs where user_id=u;
 insert into public.model_training_purge_runs select * from _reliability_purges;
 if exists(select 1 from _reliability_pref) then
  update public.model_training_preferences p set enabled=s.enabled,updated_at=s.updated_at,retention_days=s.retention_days from _reliability_pref s where p.user_id=s.user_id;
 else delete from public.model_training_preferences where user_id=u;
 end if;
end $$;
