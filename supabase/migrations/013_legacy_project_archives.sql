create table public.legacy_project_archives (
  project_id uuid primary key references public.projects(id) on delete cascade,
  legacy_project_id text not null unique,
  snapshot jsonb not null,
  source_sha256 text not null,
  imported_at timestamptz not null default now()
);

alter table public.legacy_project_archives enable row level security;
create policy legacy_project_archives_select_own on public.legacy_project_archives
  for select to authenticated using (
    exists (select 1 from public.projects where id = project_id and user_id = auth.uid())
  );
revoke insert, update, delete on public.legacy_project_archives from anon, authenticated;
