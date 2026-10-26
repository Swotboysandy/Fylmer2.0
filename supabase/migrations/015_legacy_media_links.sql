create table public.legacy_media_links (
  project_id uuid not null references public.projects(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  primary key (project_id, url)
);

create index legacy_media_links_owner_url on public.legacy_media_links (user_id, url);

alter table public.legacy_media_links enable row level security;

create policy "Owners can read imported media links" on public.legacy_media_links
  for select to authenticated using (auth.uid() = user_id);

revoke all on public.legacy_media_links from anon;
grant select on public.legacy_media_links to authenticated;
