alter table public.google_tokens add column service_health jsonb not null default '{}'::jsonb;
alter table public.google_tokens add column disconnected_at timestamptz;
alter table public.extraction_items add column manual_corrected_at timestamptz;
alter table public.extraction_items drop constraint extraction_items_item_type_check;
alter table public.extraction_items add constraint extraction_items_item_type_check check (item_type in (
 'course','assignment','deadline','event','office_hours','policy','material','reading','dataset_finding','task','project_update',
 'reference','required_form','contact_info','course_schedule','project','ignore','unknown'
));
alter table public.imported_files drop constraint imported_files_classification_check;
alter table public.imported_files add constraint imported_files_classification_check check (classification in (
 'syllabus','assignment','lecture_notes','reading','dataset','research_paper','financial_document','form','schedule','project_file','unknown',
 'reference_document','application','meeting_agenda','conference_schedule','email_export','notes'
));
alter table public.file_extractions drop constraint file_extractions_classification_check;
alter table public.file_extractions add constraint file_extractions_classification_check check (classification in (
 'syllabus','assignment','lecture_notes','reading','dataset','research_paper','financial_document','form','schedule','project_file','unknown',
 'reference_document','application','meeting_agenda','conference_schedule','email_export','notes'
));
-- Existing owner policies and server-only token permissions remain unchanged.
-- Evidence, source location and reasoning persist in extraction_items.payload.
