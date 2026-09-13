-- Cover foreign keys used by the unified ingestion pipeline.

create index if not exists imported_files_course_idx
  on public.imported_files(linked_course_id)
  where linked_course_id is not null;

create index if not exists file_extractions_user_idx
  on public.file_extractions(user_id);

create index if not exists extraction_items_file_idx
  on public.extraction_items(imported_file_id);

create index if not exists extraction_items_extraction_idx
  on public.extraction_items(extraction_id);

create index if not exists email_action_items_suggestion_idx
  on public.email_action_items(email_suggestion_id);
