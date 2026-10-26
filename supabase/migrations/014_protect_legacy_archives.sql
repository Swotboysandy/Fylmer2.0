alter table public.legacy_project_archives
  drop constraint legacy_project_archives_project_id_fkey;

alter table public.legacy_project_archives
  add constraint legacy_project_archives_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete restrict;

grant select on public.legacy_project_archives to authenticated;
