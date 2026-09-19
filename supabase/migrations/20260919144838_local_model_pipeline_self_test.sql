create temporary table _local_pipeline_user on commit drop as select id from auth.users order by created_at limit 1;
create temporary table _local_pipeline_pref on commit drop as select p.* from public.model_training_preferences p join _local_pipeline_user u on u.id=p.user_id;
do $$
declare u uuid; v_example_id uuid; v_dataset_id uuid; v_run_id uuid; v_candidate_id uuid; v_benchmark_id uuid; v_deployment_id uuid; blocked boolean:=false;
begin
 select id into u from _local_pipeline_user;if u is null then return;end if;
 if not exists(select 1 from public.model_baselines b join public.model_benchmark_versions v on v.id=b.benchmark_id where v.name='ass-golden-eval' and v.version=1 and b.model_name='gemma-4b' and b.correct=6 and b.total=12) then raise exception 'Gemma 4B baseline missing';end if;
 insert into public.model_training_preferences(user_id,enabled,retention_days) values(u,true,90) on conflict(user_id) do update set enabled=true;
 v_example_id:=public.collect_model_training_correction(u,'synthetic','codex-local-pipeline-test','classify','Fixture contains no private data','{"source_type":"synthetic"}','{"type":"REFERENCE"}',0.2,'{"type":"TASK"}');
 if not exists(select 1 from public.model_training_examples where id=v_example_id and trust_source='USER_CORRECTION' and trust_score=1 and correction_count>=1) then raise exception 'Trusted correction mapping failed';end if;
 update public.model_training_examples set quality='approved',curation_status='eligible' where id=v_example_id;
 insert into public.model_dataset_versions(user_id,name,version,content_hash,trust_threshold,example_count,train_count,validation_count,test_count,manifest)
 values(u,'codex-self-test',2147483647,repeat('f',64),.8,1,1,0,0,'{"self_test":true}') returning id into v_dataset_id;
 insert into public.model_dataset_examples(dataset_id,example_id,split,source_hash) values(v_dataset_id,v_example_id,'train',repeat('a',64));
 select id into v_benchmark_id from public.model_benchmark_versions where name='ass-golden-eval' and version=1;
 insert into public.model_training_runs(user_id,dataset_id,base_model,method,status,config,hardware) values(u,v_dataset_id,'fixture-base','lora','completed','{}','{}') returning id into v_run_id;
 insert into public.model_candidates(user_id,training_run_id,dataset_id,name,version,base_model,ollama_model_name,status) values(u,v_run_id,v_dataset_id,'codex-candidate',2147483647,'fixture-base','codex-candidate-self-test','candidate') returning id into v_candidate_id;
 insert into public.model_eval_runs(user_id,candidate_id,benchmark_id,comparison_model,status,metrics,gates,gates_passed,completed_at) values(u,v_candidate_id,v_benchmark_id,'gemma-4b','completed','{"accuracy":1}','{"all":true}',true,now());
 insert into public.model_deployments(user_id,candidate_id,ollama_model_name,status,approved_by,notes) values(u,v_candidate_id,'codex-candidate-self-test','shadow',u,'Self-test only') returning id into v_deployment_id;
 insert into public.model_shadow_predictions(user_id,candidate_id,task_type,source_hash,production_output,candidate_output,candidate_confidence,agreed,latency_ms) values(u,v_candidate_id,'classify',repeat('a',64),'{}','{}',.9,true,1);
 insert into public.model_hard_examples(user_id,training_example_id,source_type,source_id,task_type,reason,difficulty_score,disagreement_score) values(u,v_example_id,'synthetic','codex-local-pipeline-test','classify','self-test',.5,.5);
 delete from public.model_training_examples where id=v_example_id;
 if not exists(select 1 from public.model_dataset_versions where id=v_dataset_id and invalidated_at is not null) then raise exception 'Source deletion did not invalidate sealed dataset';end if;
 delete from public.model_shadow_predictions where candidate_id=v_candidate_id;
 delete from public.model_deployments where id=v_deployment_id;
 delete from public.model_eval_runs where candidate_id=v_candidate_id;
 delete from public.model_candidates where id=v_candidate_id;
 delete from public.model_training_runs where id=v_run_id;
 delete from public.model_dataset_versions where id=v_dataset_id;
 update public.model_training_preferences set enabled=false where user_id=u;
 begin perform public.collect_model_training_correction(u,'synthetic','codex-disabled-pipeline-test','classify','fixture','{}','{}',.2,'{}');exception when sqlstate '42501' then blocked:=true;end;
 if not blocked then raise exception 'Disabled consent accepted pipeline data';end if;
 if exists(select 1 from _local_pipeline_pref) then update public.model_training_preferences p set enabled=s.enabled,updated_at=s.updated_at,retention_days=s.retention_days from _local_pipeline_pref s where p.user_id=s.user_id;else delete from public.model_training_preferences where user_id=u;end if;
end $$;
