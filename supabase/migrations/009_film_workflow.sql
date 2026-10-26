create table public.film_reviews (
  project_id uuid primary key references public.projects(id) on delete cascade,
  bible text,
  images text,
  videos text,
  final_cut text,
  updated_at timestamptz not null default now()
);
alter table public.film_reviews enable row level security;
create policy film_reviews_read on public.film_reviews for select using (
  exists (select 1 from public.projects where id = project_id and user_id = auth.uid())
);
revoke insert, update, delete on public.film_reviews from anon, authenticated;

create function public.film_workflow(p_project_id uuid, p_action text default 'read')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  review public.film_reviews%rowtype;
  bible_hash text;
  image_hash text;
  video_hash text;
  images jsonb;
  videos jsonb;
  bible_ok boolean;
  images_ok boolean;
  videos_ok boolean;
begin
  select * into project from public.projects where id = p_project_id and user_id = auth.uid() for update;
  if not found then raise exception 'Project not found'; end if;
  if p_action not in ('read', 'bible', 'images', 'videos', 'final_cut') then raise exception 'Unknown review step'; end if;
  bible_hash := md5(project.script || (project.store - 'videoSettings')::text);
  select coalesce(jsonb_object_agg(key, value->'result'), '{}'::jsonb) into images
    from jsonb_each(project.generation) where value->>'connectorType' = 'image' and value->'result' <> 'null'::jsonb;
  select coalesce(jsonb_object_agg(key, value->'result'), '{}'::jsonb) into videos
    from jsonb_each(project.generation) where value->>'connectorType' = 'video' and value->'result' <> 'null'::jsonb;
  image_hash := md5(bible_hash || images::text);
  video_hash := md5(image_hash || videos::text || coalesce((project.store->'videoSettings')::text, '{}'));
  insert into public.film_reviews(project_id) values (p_project_id) on conflict do nothing;
  select * into review from public.film_reviews where project_id = p_project_id for update;
  bible_ok := coalesce(review.bible = bible_hash, false);
  images_ok := bible_ok and coalesce(review.images = image_hash, false);
  videos_ok := images_ok and coalesce(review.videos = video_hash, false);
  if p_action = 'bible' then
    if length(trim(project.script)) = 0 then raise exception 'Create your Film Bible in chat first'; end if;
    update public.film_reviews set bible = bible_hash, images = null, videos = null, final_cut = null, updated_at = now() where project_id = p_project_id;
  elsif p_action = 'images' then
    if not bible_ok or images = '{}'::jsonb then raise exception 'Approve your Film Bible and create images first'; end if;
    update public.film_reviews set images = image_hash, videos = null, final_cut = null, updated_at = now() where project_id = p_project_id;
  elsif p_action = 'videos' then
    if not images_ok or videos = '{}'::jsonb then raise exception 'Review your images and create videos first'; end if;
    update public.film_reviews set videos = video_hash, final_cut = null, updated_at = now() where project_id = p_project_id;
  elsif p_action = 'final_cut' then
    if not videos_ok then raise exception 'Review your videos first'; end if;
    update public.film_reviews set final_cut = video_hash, updated_at = now() where project_id = p_project_id;
  end if;
  select * into review from public.film_reviews where project_id = p_project_id;
  bible_ok := coalesce(review.bible = bible_hash, false);
  images_ok := bible_ok and coalesce(review.images = image_hash, false);
  videos_ok := images_ok and coalesce(review.videos = video_hash, false);
  return jsonb_build_object('bible', bible_ok, 'images', images_ok, 'videos', videos_ok,
    'finalCut', videos_ok and coalesce(review.final_cut = video_hash, false),
    'imageCount', (select count(*) from jsonb_object_keys(images)),
    'videoCount', (select count(*) from jsonb_object_keys(videos)));
end;
$$;
revoke all on function public.film_workflow(uuid, text) from public;
grant execute on function public.film_workflow(uuid, text) to authenticated;

create table public.tresca_workflows (
  project_id uuid primary key references public.projects(id) on delete cascade,
  document jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.tresca_workflows enable row level security;
create policy tresca_read on public.tresca_workflows for select using (exists (
  select 1 from public.projects where id = project_id and user_id = auth.uid()
));
revoke insert, update, delete on public.tresca_workflows from anon, authenticated;
