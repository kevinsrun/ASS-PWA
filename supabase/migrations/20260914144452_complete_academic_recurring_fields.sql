alter table public.academic_recurring_events
  add column if not exists course_id uuid references public.academic_courses(id) on delete set null,
  add column if not exists course_name text,
  add column if not exists event_type text,
  add column if not exists day_pattern text,
  add column if not exists timezone text,
  add column if not exists semester_start date,
  add column if not exists semester_end date;

update public.academic_recurring_events
set event_type = case academic_kind when 'office_hours' then 'office_hour' else academic_kind end,
    day_pattern = array_to_string(days_of_week, ','),
    timezone = time_zone,
    semester_start = start_date,
    semester_end = end_date
where event_type is null;

alter table public.academic_recurring_events
  alter column event_type set not null,
  alter column day_pattern set not null,
  alter column timezone set not null,
  alter column semester_start set not null;

alter table public.academic_recurring_events
  add constraint academic_recurring_events_event_type_check
  check (event_type in ('lecture','lab','discussion','recitation','office_hour','exam_review','conference'));

create index if not exists academic_recurring_events_course_idx
  on public.academic_recurring_events(course_id)
  where course_id is not null;
