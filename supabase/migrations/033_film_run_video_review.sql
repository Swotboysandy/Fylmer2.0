begin;
create function public.guard_film_run_video_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  images jsonb;
  image_count bigint;
  images_complete boolean;
  approved_images text;
begin
  if old.connector_type <> 'video' or old.provider_started_at is not null or not (
    (old.status = 'pending' and new.status = 'processing') or new.provider_started_at is not null
  ) then return new; end if;
  if not exists (select 1 from public.film_run_jobs where job_id = old.id) then return new; end if;
  select * into project from public.projects where id = old.project_id for update;
  select coalesce(jsonb_object_agg(key, value->'result'), '{}'::jsonb) into images
    from jsonb_each(project.generation) where value->>'connectorType' = 'image' and value->'result' <> 'null'::jsonb;
  select count(*), count(*) = count(*) filter (where images ? (image_id.capture)[1]) into image_count, images_complete
    from regexp_matches(project.script, '<image id="([^"]+)"', 'g') as image_id(capture);
  select review.images into approved_images from public.film_reviews review where project_id = project.id;
  if not images_complete or (image_count > 0 and approved_images is distinct from
    md5(md5(project.script || (project.store - 'videoSettings')::text) || images::text)) then
    raise exception 'FYLMER_RUN_WAIT: Review the current images before starting video generation.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_film_run_video_review() from public, anon, authenticated;
create trigger jobs_film_run_video_review before update on public.jobs
  for each row execute function public.guard_film_run_video_review();
notify pgrst, 'reload schema';
commit;
