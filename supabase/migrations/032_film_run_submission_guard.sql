begin;
create function public.guard_film_run_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  run public.film_runs%rowtype;
  project public.projects%rowtype;
  review public.film_reviews%rowtype;
begin
  if old.provider_started_at is not null or not (
    (old.status = 'pending' and new.status = 'processing') or new.provider_started_at is not null
  ) then return new; end if;
  if not exists (select 1 from public.film_run_jobs where job_id = old.id) then return new; end if;
  select * into project from public.projects where id = old.project_id for update;
  select runs.* into run from public.film_runs runs join public.film_run_jobs binding on binding.run_id = runs.id
    where binding.job_id = old.id for update of runs;
  if run.status in ('cancelled', 'completed', 'failed') then
    raise exception 'FYLMER_RUN_STOP: This film run has ended. No new provider request was sent.';
  end if;
  if run.status = 'paused' then
    raise exception 'FYLMER_RUN_WAIT: Film generation is paused.';
  end if;
  if not exists (select 1 from public.film_run_leases where run_id = run.id and expires_at > clock_timestamp()) then
    raise exception 'FYLMER_RUN_WAIT: Waiting for the film coordinator to resume.';
  end if;
  select * into review from public.film_reviews where project_id = project.id;
  if run.source_hash is distinct from md5(project.script || project.store::text)
    or project.generation is distinct from run.planned_generation
    or review.bible is distinct from md5(project.script || (project.store - 'videoSettings')::text)
    or review.mode is distinct from run.mode then
    raise exception 'FYLMER_RUN_STOP: The reviewed film or selected takes changed. Start a new reviewed run.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_film_run_submission() from public, anon, authenticated;
create trigger jobs_film_run_gate before update on public.jobs
  for each row execute function public.guard_film_run_submission();

create or replace function public.claim_asset_delivery()
returns setof public.asset_deliveries language plpgsql security definer set search_path = '' as $$
declare candidate uuid;
begin
  select delivery.job_id into candidate from public.asset_deliveries delivery
    join public.jobs jobs on jobs.id = delivery.job_id
    where delivery.available_at <= now() and (delivery.lease_until is null or delivery.lease_until < now())
      and not exists (
        select 1 from public.film_run_jobs binding join public.film_runs run on run.id = binding.run_id
        where binding.job_id = jobs.id and jobs.provider_started_at is null and jobs.status in ('pending', 'processing')
          and (run.status = 'paused' or (run.status = 'queued' and not exists (
            select 1 from public.film_run_leases where run_id = run.id and expires_at > clock_timestamp()
          )))
      )
    order by delivery.available_at for update of delivery skip locked limit 1;
  if candidate is null then return; end if;
  return query update public.asset_deliveries set lease_id = gen_random_uuid(), lease_until = now() + interval '10 minutes'
    where job_id = candidate returning *;
end;
$$;
notify pgrst, 'reload schema';
commit;
