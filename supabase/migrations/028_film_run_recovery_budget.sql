begin;

create or replace function public.control_film_run(p_project_id uuid, p_action text, p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  active_run public.film_runs%rowtype;
  review jsonb;
  fingerprint text;
  cap numeric;
begin
  select * into project from public.projects where id = p_project_id and user_id = auth.uid() for update;
  if not found then raise exception 'FYLMER_RUN: Project not found.'; end if;
  if p_action is null or p_action not in ('read', 'start', 'pause', 'resume', 'cancel') then
    raise exception 'FYLMER_RUN: Unknown action.';
  end if;
  if p_action = 'read' then
    select * into active_run from public.film_runs where project_id = p_project_id
      and (p_run_id is null or id = p_run_id) order by created_at desc, id desc limit 1;
    return to_jsonb(active_run);
  end if;
  if p_run_id is null then raise exception 'FYLMER_RUN: A run identity is required.'; end if;
  fingerprint := md5(project.script || project.store::text);
  select * into active_run from public.film_runs where id = p_run_id and project_id = p_project_id for update;
  if p_action = 'start' and active_run.id is not null then return to_jsonb(active_run); end if;
  if p_action <> 'start' and active_run.id is null then raise exception 'FYLMER_RUN: Run not found.'; end if;
  if p_action in ('pause', 'cancel') then
    if active_run.status in ('cancelled', 'completed', 'failed') then return to_jsonb(active_run); end if;
    update public.film_runs set status = case when p_action = 'pause' then 'paused' else 'cancelled' end,
      updated_at = now() where id = active_run.id returning * into active_run;
    return to_jsonb(active_run);
  end if;
  if p_action = 'resume' and active_run.status not in ('queued', 'paused') then
    raise exception 'FYLMER_RUN: A finished run cannot be resumed.';
  end if;
  review := public.film_workflow(p_project_id, 'read');
  if (review->>'bible')::boolean is distinct from true then
    raise exception 'FYLMER_RUN: Approve the current Film Bible before starting or resuming.';
  end if;
  select autonomous_cap_usd into cap from public.film_reviews where project_id = p_project_id;
  if cap is null then raise exception 'FYLMER_RUN: Set a per-project spending cap before starting a film run.'; end if;
  if p_action = 'start' then
    select * into active_run from public.film_runs where project_id = p_project_id and status in ('queued', 'paused') for update;
    if active_run.id is null then
      insert into public.film_runs(id, project_id, user_id, source_hash, mode)
        values (p_run_id, p_project_id, auth.uid(), fingerprint, review->>'mode') returning * into active_run;
    end if;
  end if;
  if active_run.source_hash <> fingerprint or active_run.mode is distinct from review->>'mode' then
    raise exception 'FYLMER_RUN: The script, settings or mode changed. Cancel this run and start a new reviewed run.';
  end if;
  if p_action = 'resume' then
    update public.film_runs set status = 'queued', updated_at = now() where id = active_run.id returning * into active_run;
  end if;
  return to_jsonb(active_run);
end;
$$;

create or replace function public.film_run_lease(p_run_id uuid, p_action text, p_lease_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  run public.film_runs%rowtype;
  review public.film_reviews%rowtype;
  held public.film_run_leases%rowtype;
begin
  if p_action is null or p_action not in ('claim', 'renew', 'release') then raise exception 'FYLMER_RUN: Unknown lease action.'; end if;
  select * into project from public.projects where id = (select project_id from public.film_runs where id = p_run_id) for update;
  if not found then raise exception 'FYLMER_RUN: Run not found.'; end if;
  select * into run from public.film_runs where id = p_run_id for update;
  select * into held from public.film_run_leases where run_id = p_run_id for update;
  if p_action <> 'claim' and (p_lease_id is null or held.lease_id is distinct from p_lease_id or held.expires_at <= clock_timestamp()) then return null; end if;
  if p_action = 'release' then
    delete from public.film_run_leases where run_id = p_run_id;
    return to_jsonb(held);
  end if;
  if run.status <> 'queued' then return null; end if;
  if p_action = 'claim' and held.expires_at > clock_timestamp() then return null; end if;
  if run.plan is null then raise exception 'FYLMER_RUN: Install the canonical plan before claiming execution.'; end if;
  if run.source_hash <> md5(project.script || project.store::text) or project.generation is distinct from run.planned_generation then
    raise exception 'FYLMER_RUN: The canonical project or selected takes changed.';
  end if;
  select * into review from public.film_reviews where project_id = run.project_id for update;
  if review.bible is distinct from md5(project.script || (project.store - 'videoSettings')::text)
    or review.mode is distinct from run.mode then
    raise exception 'FYLMER_RUN: Current Bible approval and run mode are required.';
  end if;
  if review.autonomous_cap_usd is null then raise exception 'FYLMER_RUN: A project cap is required.'; end if;
  insert into public.film_run_leases(run_id, lease_id, expires_at)
    values (p_run_id, case when p_action = 'renew' then p_lease_id else gen_random_uuid() end, clock_timestamp() + interval '60 seconds')
    on conflict (run_id) do update set lease_id = excluded.lease_id, expires_at = excluded.expires_at
    returning * into held;
  return to_jsonb(held);
end;
$$;

revoke all on function public.control_film_run(uuid, text, uuid) from public;
grant execute on function public.control_film_run(uuid, text, uuid) to authenticated;
revoke all on function public.film_run_lease(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.film_run_lease(uuid, text, uuid) to service_role;
notify pgrst, 'reload schema';
commit;
