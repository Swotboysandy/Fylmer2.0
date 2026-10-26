begin;

create function public.list_film_run_candidates(p_limit integer default 20)
returns table(run_id uuid) language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'FYLMER_RUN: Candidate limit must be between 1 and 100.';
  end if;
  return query
    select run.id from public.film_runs run
    where run.status = 'queued' and run.coordinator_stop is null
      and not exists (
        select 1 from public.film_run_leases held
        where held.run_id = run.id and held.expires_at > clock_timestamp()
      )
    order by run.updated_at, run.id
    limit p_limit;
end;
$$;

revoke all on function public.list_film_run_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_film_run_candidates(integer) to service_role;
notify pgrst, 'reload schema';
commit;
