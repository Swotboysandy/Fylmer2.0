begin;
create table public.film_run_jobs (
  run_id uuid not null references public.film_runs(id) on delete cascade,
  node_id text not null,
  job_id uuid not null unique references public.jobs(id),
  committed_at timestamptz,
  primary key (run_id, node_id)
);
alter table public.film_run_jobs enable row level security;
revoke all on public.film_run_jobs from anon, authenticated;
grant all on public.film_run_jobs to service_role;

create function public.admit_film_run_job(p_run_id uuid, p_lease_id uuid, p_node_id text, p_request jsonb, p_quote jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  run public.film_runs%rowtype;
  project public.projects%rowtype;
  node jsonb;
  dependency jsonb;
  linked uuid;
  original_request jsonb;
  images jsonb;
  image_count bigint;
  images_complete boolean;
  approved_images text;
begin
  if public.film_run_lease(p_run_id, 'renew', p_lease_id) is null then
    raise exception 'FYLMER_RUN: The worker lease is no longer valid.';
  end if;
  select * into run from public.film_runs where id = p_run_id;
  select value into node from jsonb_array_elements(run.plan->'nodes') where value->>'id' = p_node_id;
  if node is null or node->>'action' is distinct from 'generate' then
    raise exception 'FYLMER_RUN: This node is not scheduled for generation.';
  end if;
  if node->>'connectorType' not in ('image', 'video', 'tts', 'music', 'sfx') then
    raise exception 'FYLMER_RUN: This node does not use a provider generation job.';
  end if;
  if jsonb_typeof(p_request) is distinct from 'object'
    or p_request->>'provider' is distinct from node->'model'->>'provider'
    or p_request->>'model' is distinct from node->'model'->>'model' then
    raise exception 'FYLMER_RUN: The request must use the planned model.';
  end if;
  select binding.job_id, jobs.request into linked, original_request
    from public.film_run_jobs binding join public.jobs on jobs.id = binding.job_id
    where binding.run_id = p_run_id and binding.node_id = p_node_id;
  if linked is not null then
    if original_request is distinct from p_request then
      raise exception 'FYLMER_RUN: This step already has a different immutable request.';
    end if;
    return linked;
  end if;
  for dependency in
    select value from jsonb_array_elements(run.plan->'nodes')
      where value->>'id' in (select value from jsonb_each_text(node->'dependsOn'))
  loop
    if dependency->>'action' = 'generate' and not exists (
      select 1 from public.film_run_jobs where run_id = p_run_id and node_id = dependency->>'id' and committed_at is not null
    ) then raise exception 'FYLMER_RUN: Commit the required dependency before admitting this step.'; end if;
  end loop;
  if node->>'connectorType' = 'video' then
    select * into project from public.projects where id = run.project_id;
    select coalesce(jsonb_object_agg(key, value->'result'), '{}'::jsonb) into images
      from jsonb_each(project.generation) where value->>'connectorType' = 'image' and value->'result' <> 'null'::jsonb;
    select count(*), count(*) = count(*) filter (where images ? (image_id.capture)[1]) into image_count, images_complete
      from regexp_matches(project.script, '<image id="([^"]+)"', 'g') as image_id(capture);
    select review.images into approved_images from public.film_reviews review where project_id = run.project_id;
    if not images_complete or (image_count > 0 and approved_images is distinct from
      md5(md5(project.script || (project.store - 'videoSettings')::text) || images::text)) then
      raise exception 'FYLMER_RUN: Review the current images before admitting video.';
    end if;
  end if;
  insert into public.jobs(user_id, project_id, connector_type, request, cost_quote)
    values (run.user_id, run.project_id, node->>'connectorType', p_request, p_quote) returning id into linked;
  insert into public.film_run_jobs(run_id, node_id, job_id) values (p_run_id, p_node_id, linked);
  return linked;
end;
$$;
revoke all on function public.admit_film_run_job(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.admit_film_run_job(uuid, uuid, text, jsonb, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
