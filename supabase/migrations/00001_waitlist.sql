-- supabase/migrations/00001_waitlist.sql

create table public.waitlist (
  id uuid default gen_random_uuid() primary key,
  email text not null unique,
  created_at timestamptz default now()
);

alter table public.waitlist enable row level security;

create policy "Anyone can insert waitlist" on public.waitlist
  for insert with check (true);
