begin;

create table public.film_runs (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_hash text not null,
  mode text not null check (mode in ('directed', 'autonomous')),
  status text not null default 'queued' check (status in ('queued', 'paused', 'cancelled', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index film_runs_one_active_project on public.film_runs(project_id)
  where status in ('queued', 'paused');
create index film_runs_project_history on public.film_runs(project_id, created_at desc);
alter table public.film_runs enable row level security;
revoke all on public.film_runs from anon, authenticated;
grant select on public.film_runs to authenticated;
grant all on public.film_runs to service_role;
create policy film_runs_read_owner on public.film_runs for select to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.projects where projects.id = film_runs.project_id and projects.user_id = auth.uid()
  ));

create function public.control_film_run(p_project_id uuid, p_action text, p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  active_run public.film_runs%rowtype;
  review jsonb;
  fingerprint text;
  cap numeric;
  committed numeric;
  uncertain boolean;
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

  if p_action = 'start' and active_run.id is not null then
    return to_jsonb(active_run);
  end if;
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
  select committed_usd, has_uncertain into committed, uncertain from public.film_budget_totals(p_project_id);
  if uncertain then raise exception 'FYLMER_RUN: Reconcile uncertain provider charges before continuing.'; end if;
  if committed >= cap then raise exception 'FYLMER_RUN: The project spending cap has been reached.'; end if;

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

revoke all on function public.control_film_run(uuid, text, uuid) from public;
grant execute on function public.control_film_run(uuid, text, uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
