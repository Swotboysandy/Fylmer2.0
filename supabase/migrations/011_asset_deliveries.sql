create table public.asset_deliveries (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz
);
alter table public.asset_deliveries enable row level security;
revoke all on public.asset_deliveries from anon, authenticated;

create function public.claim_asset_delivery()
returns setof public.asset_deliveries language plpgsql security definer set search_path = '' as $$
declare candidate uuid;
begin
  select job_id into candidate from public.asset_deliveries
    where available_at <= now() and (lease_until is null or lease_until < now())
    order by available_at for update skip locked limit 1;
  if candidate is null then return; end if;
  return query update public.asset_deliveries set lease_id = gen_random_uuid(), lease_until = now() + interval '10 minutes'
    where job_id = candidate returning *;
end;
$$;
revoke all on function public.claim_asset_delivery() from public, anon, authenticated;
grant execute on function public.claim_asset_delivery() to service_role;
