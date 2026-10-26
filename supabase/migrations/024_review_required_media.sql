create or replace function public.film_workflow(p_project_id uuid, p_action text default 'read')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  review public.film_reviews%rowtype;
  bible_hash text;
  image_hash text;
  video_hash text;
  final_hash text;
  images jsonb;
  videos jsonb;
  bible_ok boolean;
  images_ok boolean;
  videos_ok boolean;
  images_complete boolean;
  image_total integer;
  video_total integer;
  videos_complete boolean;
begin
  select * into project from public.projects where id = p_project_id and user_id = auth.uid() for update;
  if not found then raise exception 'Project not found'; end if;
  if p_action not in ('read', 'bible', 'autonomous', 'directed', 'images', 'videos', 'final_cut') then raise exception 'Unknown review step'; end if;
  bible_hash := md5(project.script || (project.store - 'videoSettings')::text);
  select coalesce(jsonb_object_agg(key, value->'result'), '{}'::jsonb) into images
    from jsonb_each(project.generation) where value->>'connectorType' = 'image' and value->'result' <> 'null'::jsonb;
  select coalesce(jsonb_object_agg(key, value->'result'), '{}'::jsonb) into videos
    from jsonb_each(project.generation) where value->>'connectorType' = 'video' and value->'result' <> 'null'::jsonb;
  select count(*), count(*) = count(*) filter (where images ? (image_id.capture)[1]) into image_total, images_complete
    from regexp_matches(project.script, '<image id="([^"]+)"', 'g') as image_id(capture);
  select count(*), count(*) = count(*) filter (where videos ? (video_id.capture)[1]) into video_total, videos_complete
    from regexp_matches(project.script, '<video id="([^"]+)"', 'g') as video_id(capture);
  image_hash := md5(bible_hash || images::text);
  video_hash := md5(image_hash || videos::text || coalesce((project.store->'videoSettings')::text, '{}'));
  select md5(video_hash || coalesce(jsonb_object_agg(key, value->'result'), '{}'::jsonb)::text) into final_hash
    from jsonb_each(project.generation) where value->'result' <> 'null'::jsonb;
  insert into public.film_reviews(project_id) values (p_project_id) on conflict do nothing;
  select * into review from public.film_reviews where project_id = p_project_id for update;
  bible_ok := coalesce(review.bible = bible_hash, false);
  images_ok := bible_ok and images_complete and (image_total = 0 or coalesce(review.images = image_hash, false));
  videos_ok := images_ok and videos_complete and (video_total = 0 or coalesce(review.videos = video_hash, false));

  if p_action = 'bible' then
    if length(trim(project.script)) = 0 then raise exception 'Create your Film Bible in chat first'; end if;
    update public.film_reviews set bible = bible_hash, images = null, videos = null, final_cut = null, updated_at = now() where project_id = p_project_id;
  elsif p_action in ('autonomous', 'directed') then
    if not bible_ok then raise exception 'Approve your Film Bible before choosing a mode'; end if;
    if p_action = 'autonomous' and review.autonomous_cap_usd is null then raise exception 'Set a per-project spending cap before turning on Autonomous'; end if;
    update public.film_reviews as current_review set mode = p_action,
      images = case when p_action = 'directed' and review.mode is distinct from 'directed' then null else current_review.images end,
      videos = case when p_action = 'directed' and review.mode is distinct from 'directed' then null else current_review.videos end,
      final_cut = case when p_action = 'directed' and review.mode is distinct from 'directed' then null else current_review.final_cut end,
      updated_at = now() where current_review.project_id = p_project_id;
  elsif p_action = 'images' then
    if review.mode is distinct from 'directed' or not bible_ok or not images_complete then raise exception 'Choose Directed mode, approve your Film Bible, and complete every scripted image first'; end if;
    update public.film_reviews set images = image_hash, videos = null, final_cut = null, updated_at = now() where project_id = p_project_id;
  elsif p_action = 'videos' then
    if review.mode is distinct from 'directed' or not images_ok or not videos_complete then raise exception 'Review your images and complete every scripted video first'; end if;
    update public.film_reviews set videos = video_hash, final_cut = null, updated_at = now() where project_id = p_project_id;
  elsif p_action = 'final_cut' then
    if not videos_ok or image_total + video_total = 0 then raise exception 'Complete and review the visual clips in your film first'; end if;
    update public.film_reviews set final_cut = final_hash, updated_at = now() where project_id = p_project_id;
  end if;

  select * into review from public.film_reviews where project_id = p_project_id;
  bible_ok := coalesce(review.bible = bible_hash, false);
  if review.mode = 'autonomous' and bible_ok then
    if images_complete then
      update public.film_reviews set images = image_hash, updated_at = now() where project_id = p_project_id;
    end if;
    if images_complete and videos_complete then
      update public.film_reviews set videos = video_hash, updated_at = now() where project_id = p_project_id;
    end if;
  end if;
  select * into review from public.film_reviews where project_id = p_project_id;
  images_ok := bible_ok and images_complete and (image_total = 0 or coalesce(review.images = image_hash, false));
  videos_ok := images_ok and videos_complete and (video_total = 0 or coalesce(review.videos = video_hash, false));
  return jsonb_build_object('mode', review.mode, 'capUsd', review.autonomous_cap_usd, 'bible', bible_ok, 'images', images_ok, 'videos', videos_ok,
    'finalCut', videos_ok and coalesce(review.final_cut = final_hash, false),
    'imageCount', (select count(*) from jsonb_object_keys(images)),
    'videoCount', (select count(*) from jsonb_object_keys(videos)));
end;
$$;
