begin;
create table public.film_run_leases (
  run_id uuid primary key references public.film_runs(id) on delete cascade,
  lease_id uuid not null,
  expires_at timestamptz not null
);
alter table public.film_run_leases enable row level security;
revoke all on public.film_run_leases from anon, authenticated;
grant all on public.film_run_leases to service_role;

create function public.revoke_stopped_film_run_lease()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'queued' then delete from public.film_run_leases where run_id = new.id; end if;
  return new;
end;
$$;
revoke all on function public.revoke_stopped_film_run_lease() from public;
create trigger revoke_stopped_film_run_lease after update of status on public.film_runs
  for each row execute function public.revoke_stopped_film_run_lease();

create function public.film_run_lease(p_run_id uuid, p_action text, p_lease_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  run public.film_runs%rowtype;
  review public.film_reviews%rowtype;
  held public.film_run_leases%rowtype;
  committed numeric;
  uncertain boolean;
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
  select committed_usd, has_uncertain into committed, uncertain from public.film_budget_totals(run.project_id);
  if uncertain or committed >= review.autonomous_cap_usd then
    raise exception 'FYLMER_RUN: Resolve the project budget before continuing.';
  end if;
  insert into public.film_run_leases(run_id, lease_id, expires_at)
    values (p_run_id, case when p_action = 'renew' then p_lease_id else gen_random_uuid() end, clock_timestamp() + interval '60 seconds')
    on conflict (run_id) do update set lease_id = excluded.lease_id, expires_at = excluded.expires_at
    returning * into held;
  return to_jsonb(held);
end;
$$;
revoke all on function public.film_run_lease(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.film_run_lease(uuid, text, uuid) to service_role;
notify pgrst, 'reload schema';
commit;
