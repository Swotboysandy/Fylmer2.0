begin;

alter table public.film_runs add column coordinator_stop text
  check (coordinator_stop in ('images_review', 'final_review', 'job_attention'));

create function public.clear_film_run_coordinator_stop()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status <> 'paused' then new.coordinator_stop := null; end if;
  return new;
end;
$$;

create trigger film_runs_clear_coordinator_stop before update of status on public.film_runs
  for each row execute function public.clear_film_run_coordinator_stop();

create function public.stop_film_run_coordinator(p_run_id uuid, p_lease_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  held jsonb;
  stopped public.film_runs%rowtype;
begin
  if p_reason is null or p_reason not in ('images_review', 'final_review', 'job_attention') then
    raise exception 'FYLMER_RUN: Invalid coordinator stop reason.';
  end if;
  held := public.film_run_lease(p_run_id, 'renew', p_lease_id);
  if held is null then raise exception 'FYLMER_RUN: Coordinator lease was lost.'; end if;
  update public.film_runs set status = 'paused', coordinator_stop = p_reason, updated_at = now()
    where id = p_run_id returning * into stopped;
  return to_jsonb(stopped);
end;
$$;

revoke all on function public.clear_film_run_coordinator_stop() from public, anon, authenticated;
revoke all on function public.stop_film_run_coordinator(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.stop_film_run_coordinator(uuid, uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;
