alter table public.file_extractions add column source_text text;
create table public.document_chunks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 extraction_id uuid not null references public.file_extractions(id) on delete cascade,
 ordinal integer not null, section_kind text not null, location text not null, content text not null,
 search_vector tsvector generated always as (to_tsvector('english',content)) stored,
 unique(extraction_id,ordinal)
);
create index document_chunks_owner_extraction on public.document_chunks(user_id,extraction_id);
create index document_chunks_search on public.document_chunks using gin(search_vector);
alter table public.document_chunks enable row level security;
create policy document_chunks_owner_read on public.document_chunks for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.document_chunks from anon,authenticated;
grant select on public.document_chunks to authenticated;
grant all on public.document_chunks to service_role;
