begin;

alter table public.film_runs
  add column completed_export_id uuid,
  add column completed_approval_hash text,
  add column completed_at timestamptz;

create function public.complete_film_run_export(p_run_id uuid, p_user_id uuid, p_project_id uuid, p_render_id uuid, p_approval_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  run public.film_runs%rowtype;
  review public.film_reviews%rowtype;
begin
  if p_render_id is null or p_approval_hash is null or p_approval_hash !~ '^[a-f0-9]{32}$' then
    raise exception 'FYLMER_EXPORT: Invalid completed export identity.';
  end if;
  select * into project from public.projects where id = p_project_id and user_id = p_user_id for update;
  if not found then return false; end if;
  select * into run from public.film_runs where id = p_run_id and project_id = project.id and user_id = p_user_id for update;
  if not found then return false; end if;
  if run.status = 'completed' then
    return coalesce(run.completed_export_id = p_render_id and run.completed_approval_hash = p_approval_hash, false);
  end if;
  select * into review from public.film_reviews where project_id = project.id for update;
  if run.status <> 'paused' or run.coordinator_stop is distinct from 'final_review'
    or run.source_hash is distinct from md5(project.script || project.store::text)
    or run.planned_generation is distinct from project.generation
    or run.mode is distinct from review.mode
    or review.final_cut is distinct from p_approval_hash
    or coalesce(jsonb_array_length(run.plan->'nodes'), 0) = 0 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(run.plan->'nodes') node
    where node->>'action' = 'generate' and not exists (
      select 1 from public.film_run_jobs binding
      where binding.run_id = run.id and binding.node_id = node->>'id' and binding.committed_at is not null
    )
  ) then return false; end if;
  update public.film_runs set status = 'completed', completed_export_id = p_render_id,
    completed_approval_hash = p_approval_hash, completed_at = now(), updated_at = now()
    where id = run.id;
  return true;
end;
$$;

revoke all on function public.complete_film_run_export(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_film_run_export(uuid, uuid, uuid, uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;
