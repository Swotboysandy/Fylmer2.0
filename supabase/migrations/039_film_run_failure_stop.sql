begin;

create or replace function public.stop_film_run_coordinator(p_run_id uuid, p_lease_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  stopped public.film_runs%rowtype;
  held public.film_run_leases%rowtype;
begin
  if p_reason is null or p_reason not in ('images_review', 'final_review', 'job_attention') then
    raise exception 'FYLMER_RUN: Invalid coordinator stop reason.';
  end if;
  perform 1 from public.projects where id = (select project_id from public.film_runs where id = p_run_id) for update;
  if not found then raise exception 'FYLMER_RUN: Run not found.'; end if;
  select * into stopped from public.film_runs where id = p_run_id for update;
  select * into held from public.film_run_leases where run_id = p_run_id for update;
  if stopped.status <> 'queued' or p_lease_id is null or held.lease_id is distinct from p_lease_id
    or held.expires_at <= clock_timestamp() then
    raise exception 'FYLMER_RUN: Coordinator lease was lost.';
  end if;
  update public.film_runs set status = 'paused', coordinator_stop = p_reason, updated_at = now()
    where id = p_run_id returning * into stopped;
  return to_jsonb(stopped);
end;
$$;

revoke all on function public.stop_film_run_coordinator(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.stop_film_run_coordinator(uuid, uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;
