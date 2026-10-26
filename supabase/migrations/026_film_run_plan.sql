begin;
alter table public.film_runs add column plan jsonb, add column planned_generation jsonb;

create function public.install_film_run_plan(p_run_id uuid, p_generation jsonb, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  run public.film_runs%rowtype;
begin
  select * into project from public.projects where id = (select project_id from public.film_runs where id = p_run_id) for update;
  if not found then raise exception 'FYLMER_RUN: Run not found.'; end if;
  select * into run from public.film_runs where id = p_run_id for update;
  if run.status <> 'queued' then raise exception 'FYLMER_RUN: Only queued runs can be planned.'; end if;
  if run.source_hash <> md5(project.script || project.store::text) or project.generation is distinct from p_generation then
    raise exception 'FYLMER_RUN: The canonical project or selected takes changed while planning.';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object' or p_plan->>'version' is distinct from '1'
    or jsonb_typeof(p_plan->'nodes') is distinct from 'array'
    or jsonb_typeof(p_plan->'rootIds') is distinct from 'array' then
    raise exception 'FYLMER_RUN: Invalid run plan.';
  end if;
  if jsonb_array_length(p_plan->'nodes') = 0 or jsonb_array_length(p_plan->'rootIds') = 0 then
    raise exception 'FYLMER_RUN: A film run needs planned clips.';
  end if;
  if run.plan is not null then
    if run.plan is distinct from p_plan or run.planned_generation is distinct from p_generation then
      raise exception 'FYLMER_RUN: An installed run plan cannot be replaced.';
    end if;
    return run.plan;
  end if;
  update public.film_runs set plan = p_plan, planned_generation = p_generation, updated_at = now() where id = p_run_id;
  return p_plan;
end;
$$;
revoke all on function public.install_film_run_plan(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.install_film_run_plan(uuid, jsonb, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
