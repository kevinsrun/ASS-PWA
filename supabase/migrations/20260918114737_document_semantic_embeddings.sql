create extension if not exists vector with schema extensions;
alter table public.document_chunks add column embedding extensions.vector(768), add column embedding_model text;
alter table public.file_extractions add column embedding_error text, add column embedded_at timestamptz;
create index document_chunks_embedding on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);
create function public.match_document_chunks(p_user_id uuid,p_extraction_id uuid,p_query extensions.vector(768),p_model text)
returns table(id uuid,ordinal integer,section_kind text,location text,content text,similarity double precision)
language sql stable security invoker set search_path = '' as $$
 select c.id,c.ordinal,c.section_kind,c.location,c.content,1-(c.embedding operator(extensions.<=>) p_query)
 from public.document_chunks c where c.user_id=p_user_id and c.extraction_id=p_extraction_id and c.embedding_model=p_model and c.embedding is not null
 order by c.embedding operator(extensions.<=>) p_query limit 8;
$$;
revoke all on function public.match_document_chunks(uuid,uuid,extensions.vector,text) from public,anon,authenticated;
grant execute on function public.match_document_chunks(uuid,uuid,extensions.vector,text) to service_role;
