begin;
create function public.dispatch_film_run_job(p_run_id uuid, p_lease_id uuid, p_node_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  linked uuid;
  job_status text;
begin
  if public.film_run_lease(p_run_id, 'renew', p_lease_id) is null then
    raise exception 'FYLMER_RUN: The worker lease is no longer valid.';
  end if;
  select jobs.id, jobs.status into linked, job_status
    from public.film_run_jobs binding join public.jobs on jobs.id = binding.job_id
    where binding.run_id = p_run_id and binding.node_id = p_node_id
    for update of jobs;
  if linked is null then
    raise exception 'FYLMER_RUN: Admit this planned step before dispatching it.';
  end if;
  if job_status in ('pending', 'processing') then
    insert into public.asset_deliveries(job_id) values (linked)
      on conflict (job_id) do nothing;
  end if;
  return linked;
end;
$$;
revoke all on function public.dispatch_film_run_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.dispatch_film_run_job(uuid, uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;
