alter table public.jobs
  add column cost_quote jsonb,
  add column reserved_cost_usd numeric check (reserved_cost_usd >= 0 and reserved_cost_usd < 1000000),
  add column billing_state text check (billing_state in ('reserved', 'submitted', 'settled', 'released', 'uncertain')),
  add column billing_review_reference text,
  add column provider_started_at timestamptz;

create function public.film_budget_totals(p_project_id uuid, p_exclude_job uuid default null)
returns table(committed_usd numeric, has_uncertain boolean)
language sql security definer set search_path = '' as $$
  select coalesce(sum(case
    when billing_state = 'released' then 0
    else greatest(coalesce(reserved_cost_usd, 0) * case when billing_state = 'settled' then 0 else 1 end,
      case when cost_usd >= 0 and cost_usd < 1000000 then cost_usd else 0 end)
    end), 0),
    coalesce(bool_or(billing_state = 'uncertain' or
      (billing_state is null and (status in ('pending', 'processing') or cost_usd is null or not (cost_usd >= 0 and cost_usd < 1000000)))), false)
  from public.jobs where project_id = p_project_id and (p_exclude_job is null or id <> p_exclude_job);
$$;
revoke all on function public.film_budget_totals(uuid, uuid) from public, anon, authenticated;
grant execute on function public.film_budget_totals(uuid, uuid) to service_role;

create function public.enforce_project_job_budget()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  project_cap numeric;
  project_mode text;
  committed numeric;
  uncertain boolean;
  ceiling numeric;
  valid_cost boolean;
  starting boolean := false;
begin
  if new.project_id is null then return new; end if;
  select user_id into owner_id from public.projects where id = new.project_id for update;
  if not found or owner_id <> new.user_id then raise exception 'FYLMER_BUDGET: Project ownership could not be verified.'; end if;
  select autonomous_cap_usd, mode into project_cap, project_mode from public.film_reviews where project_id = new.project_id;
  if tg_op = 'UPDATE' then
	if old.status in ('failed', 'completed') and new.status is distinct from old.status then
	  raise exception 'FYLMER_BUDGET: A finished job cannot be restarted. Submit a new job with a new reservation.';
	end if;
    starting := new.provider_started_at is not null and old.provider_started_at is null;
    if new.provider_started_at is distinct from old.provider_started_at and
      (not starting or old.status <> 'processing') then
      raise exception 'FYLMER_BUDGET: Provider submission can only be recorded once, while processing.';
    end if;
    if new.project_id is distinct from old.project_id or new.user_id is distinct from old.user_id or
      new.request is distinct from old.request or new.cost_quote is distinct from old.cost_quote or
      new.reserved_cost_usd is distinct from old.reserved_cost_usd then
      raise exception 'FYLMER_BUDGET: A queued job cannot change its project, request or reserved price.';
    end if;
    new.billing_state := old.billing_state;
    if new.billing_review_reference is distinct from old.billing_review_reference then
      if (old.billing_state is distinct from 'uncertain' and not (old.billing_state is null and
          (old.cost_usd is null or not (old.cost_usd >= 0 and old.cost_usd < 1000000)))) or
        old.status not in ('failed', 'completed') or
        length(trim(coalesce(new.billing_review_reference, ''))) < 8 or
        new.cost_usd is null or not (new.cost_usd >= 0 and new.cost_usd < 1000000) then
        raise exception 'FYLMER_BUDGET: Reconcile only a finished uncertain charge with verified billing evidence.';
      end if;
      new.billing_state := 'settled';
      return new;
    end if;
    if old.billing_state in ('settled', 'released') and new.cost_usd is distinct from old.cost_usd then
      raise exception 'FYLMER_BUDGET: A settled provider charge cannot be overwritten.';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.billing_state := null;
    new.reserved_cost_usd := null;
    new.billing_review_reference := null;
    new.provider_started_at := null;
    if project_cap is null and project_mode is distinct from 'autonomous' then return new; end if;
    if project_cap is null then raise exception 'FYLMER_BUDGET: Set a per-project cap before Autonomous generation.'; end if;
    if new.cost_quote is null or new.cost_quote->>'currency' is distinct from 'USD' or
      new.cost_quote->>'provider' is distinct from new.request->>'provider' or
      new.cost_quote->>'model' is distinct from new.request->>'model' then
      raise exception 'FYLMER_BUDGET: A verified price is required before generating with a project cap.';
    end if;
    ceiling := (new.cost_quote->>'ceilingUsd')::numeric;
    if ceiling is null or not (ceiling >= 0 and ceiling < 1000000) or
      (new.cost_quote->>'expiresAt')::timestamptz is null or
      (new.cost_quote->>'expiresAt')::timestamptz <= now() or
      (new.cost_quote->>'expiresAt')::timestamptz > now() + interval '10 minutes' then
      raise exception 'FYLMER_BUDGET: The price is invalid or expired. No job was started.';
    end if;
    select committed_usd, has_uncertain into committed, uncertain from public.film_budget_totals(new.project_id);
    if uncertain then raise exception 'FYLMER_BUDGET: A previous provider charge needs billing review before another job can start.'; end if;
    if committed + ceiling > project_cap then raise exception 'FYLMER_BUDGET: This job would exceed the project cap, including queued and in-progress jobs.'; end if;
    new.reserved_cost_usd := ceiling;
    new.billing_state := 'reserved';
  end if;
  if tg_op = 'UPDATE' and ((new.status = 'processing' and old.status = 'pending') or starting) then
    if (project_cap is not null or project_mode = 'autonomous') and new.billing_state is null then
      raise exception 'FYLMER_BUDGET: This queued job has no budget reservation. Submit it again with verified pricing.';
    end if;
    if new.billing_state = 'reserved' then
      if (new.cost_quote->>'expiresAt')::timestamptz <= now() then
        raise exception 'FYLMER_BUDGET: The queued price expired before submission. Retry for a fresh price.';
      end if;
      select committed_usd, has_uncertain into committed, uncertain from public.film_budget_totals(new.project_id, new.id);
      if uncertain or project_cap is null or committed + new.reserved_cost_usd > project_cap then
        raise exception 'FYLMER_BUDGET: Project billing changed while queued. Review the cap and unresolved charges before retrying.';
      end if;
      if starting then new.billing_state := 'submitted'; end if;
    end if;
  end if;
  valid_cost := new.cost_usd is not null and new.cost_usd >= 0 and new.cost_usd < 1000000;
  if new.billing_state in ('reserved', 'submitted') and new.status = 'completed' then
    new.billing_state := case when valid_cost and new.cost_usd <= new.reserved_cost_usd then 'settled' else 'uncertain' end;
  elsif new.status = 'failed' then
    if new.billing_state = 'reserved' then new.billing_state := 'released';
    elsif new.billing_state = 'submitted' then new.billing_state := 'uncertain';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_project_job_budget() from public, anon, authenticated;
create trigger jobs_project_budget before insert or update on public.jobs
for each row execute function public.enforce_project_job_budget();

create or replace function public.set_film_autonomous_cap(p_project_id uuid, p_cap_usd numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  committed numeric;
begin
  if p_cap_usd is null or not (p_cap_usd >= 0.01 and p_cap_usd <= 10000) then raise exception 'FYLMER_BUDGET: Set a cap between $0.01 and $10,000.'; end if;
  perform 1 from public.projects where id = p_project_id and user_id = auth.uid() for update;
  if not found then raise exception 'Project not found'; end if;
  select committed_usd into committed from public.film_budget_totals(p_project_id);
  if p_cap_usd < committed then raise exception 'FYLMER_BUDGET: The cap cannot be lower than settled charges and active reservations.'; end if;
  insert into public.film_reviews(project_id, autonomous_cap_usd) values (p_project_id, p_cap_usd)
    on conflict (project_id) do update set autonomous_cap_usd = excluded.autonomous_cap_usd, updated_at = now();
end;
$$;

create function public.reconcile_film_job_charge(p_job_id uuid, p_cost_usd numeric, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_cost_usd is null or not (p_cost_usd >= 0 and p_cost_usd < 1000000) or length(trim(coalesce(p_reference, ''))) < 8 then
    raise exception 'Verified provider billing and its evidence reference are required';
  end if;
  update public.jobs set cost_usd = p_cost_usd, billing_review_reference = p_reference
    where id = p_job_id and status in ('failed', 'completed') and
      (billing_state = 'uncertain' or (billing_state is null and
        (cost_usd is null or not (cost_usd >= 0 and cost_usd < 1000000))));
  if not found then raise exception 'Uncertain finished job not found'; end if;
end;
$$;
revoke all on function public.reconcile_film_job_charge(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.reconcile_film_job_charge(uuid, numeric, text) to service_role;
