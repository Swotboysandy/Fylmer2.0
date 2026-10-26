create table public.legacy_identity_map (
  legacy_user_id text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.legacy_identity_map enable row level security;
revoke all on public.legacy_identity_map from anon, authenticated;
