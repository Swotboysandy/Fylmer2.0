begin;
alter table public.film_runs add column expected_generation jsonb;

create function public.film_run_generation(p_run public.film_runs)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(p_run.expected_generation, p_run.planned_generation);
$$;
revoke all on function public.film_run_generation(public.film_runs) from public, anon, authenticated;
grant execute on function public.film_run_generation(public.film_runs) to service_role;

create function public.commit_film_run_job(p_run_id uuid, p_lease_id uuid, p_node_id text, p_bundle jsonb, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.film_runs%rowtype;
  project public.projects%rowtype;
  binding public.film_run_jobs%rowtype;
  job public.jobs%rowtype;
  node jsonb;
  dependency record;
  dependency_result jsonb;
  dependencies jsonb := '{}'::jsonb;
  inputs jsonb;
  previous jsonb;
  next_generation jsonb;
  url_field text;
begin
  if public.film_run_lease(p_run_id, 'renew', p_lease_id) is null then
    raise exception 'FYLMER_RUN: The worker lease is no longer valid.';
  end if;
  select * into run from public.film_runs where id = p_run_id;
  select * into project from public.projects where id = run.project_id;
  select * into binding from public.film_run_jobs where run_id = p_run_id and node_id = p_node_id for update;
  if not found then raise exception 'FYLMER_RUN: No admitted job exists for this step.'; end if;
  if binding.committed_at is not null then return project.generation; end if;
  select * into job from public.jobs where id = binding.job_id for update;
  select value into node from jsonb_array_elements(run.plan->'nodes') where value->>'id' = p_node_id;
  if job.status <> 'completed' or job.result is null or job.result is distinct from p_bundle
    or job.project_id is distinct from run.project_id or job.user_id is distinct from run.user_id
    or job.connector_type is distinct from node->>'connectorType'
    or job.request->>'provider' is distinct from node->'model'->>'provider'
    or job.request->>'model' is distinct from node->'model'->>'model' then
    raise exception 'FYLMER_RUN: Commit only the matching completed provider job.';
  end if;
  previous := project.generation->p_node_id;
  if node->>'action' is distinct from 'generate' or node->>'pinned' = 'true' or previous->>'pinned' = 'true' then
    raise exception 'FYLMER_RUN: A supplied or reused take cannot be replaced by this run.';
  end if;
  url_field := case job.connector_type when 'image' then 'imageUrl' when 'video' then 'videoUrl' else 'audioUrl' end;
  if jsonb_typeof(p_result) is distinct from 'object' or jsonb_typeof(p_result->'durationSec') is distinct from 'number'
    or not (p_result->>'durationSec')::numeric >= 0
    or (job.connector_type <> 'image' and not (p_result->>'durationSec')::numeric > 0)
    or coalesce(p_result->>url_field, '') !~ '^https?://' then
    raise exception 'FYLMER_RUN: A resolved media result with valid timing is required.';
  end if;
  for dependency in select key, value from jsonb_each_text(node->'dependsOn') loop
    dependency_result := project.generation->dependency.value->'result';
    if dependency_result is null or dependency_result = 'null'::jsonb then
      raise exception 'FYLMER_RUN: A required selected dependency is missing.';
    end if;
    dependencies := dependencies || jsonb_build_object(dependency.key, concat_ws('|',
      nullif(dependency_result->>'imageUrl', ''), nullif(dependency_result->>'audioUrl', ''),
      nullif(dependency_result->>'videoUrl', ''), nullif(dependency_result->>'voiceId', '')));
  end loop;
  inputs := node->'inputs' || jsonb_build_object('dependencies', dependencies);
  if previous->'result' is not null and previous->'result' <> 'null'::jsonb then
    if jsonb_typeof(previous->'resultInputs') is distinct from 'object' then
      raise exception 'FYLMER_RUN: Preserve the existing take inputs before replacing it.';
    end if;
    insert into public.element_history(id, project_id, element_id, connector_type, element_type, inputs, result, pinned)
      select gen_random_uuid(), run.project_id, p_node_id, previous->>'connectorType', node->>'elementType',
        previous->'resultInputs', previous->'result', false
      where not exists (select 1 from public.element_history where project_id = run.project_id and element_id = p_node_id
        and result = previous->'result' and inputs = previous->'resultInputs');
  end if;
  insert into public.element_history(id, project_id, element_id, connector_type, element_type, inputs, result, pinned)
    values (job.id, run.project_id, p_node_id, job.connector_type, node->>'elementType', inputs, p_result, false);
  next_generation := project.generation || jsonb_build_object(p_node_id, jsonb_build_object(
    'status', 'idle', 'startedAt', null, 'result', p_result, 'error', null,
    'resultInputs', inputs, 'connectorType', job.connector_type, 'pinned', false));
  update public.projects set generation = next_generation where id = run.project_id;
  update public.film_runs set expected_generation = next_generation, updated_at = now() where id = p_run_id;
  update public.film_run_jobs set committed_at = now() where run_id = p_run_id and node_id = p_node_id;
  return next_generation;
end;
$$;
revoke all on function public.commit_film_run_job(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_film_run_job(uuid, uuid, text, jsonb, jsonb) to service_role;

do $$
declare signature regprocedure; definition text;
begin
  foreach signature in array array['public.film_run_lease(uuid,text,uuid)'::regprocedure, 'public.guard_film_run_submission()'::regprocedure] loop
    definition := pg_get_functiondef(signature);
    if position('project.generation is distinct from run.planned_generation' in definition) = 0 then
      raise exception 'Expected original checkpoint guard not found: %', signature;
    end if;
    execute replace(definition, 'project.generation is distinct from run.planned_generation',
      'project.generation is distinct from public.film_run_generation(run)');
  end loop;
end;
$$;
notify pgrst, 'reload schema';
commit;
