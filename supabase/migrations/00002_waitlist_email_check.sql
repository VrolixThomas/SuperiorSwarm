-- Validate email format at database level to prevent garbage inserts via direct API
-- Pattern: something@something.something (min 3 chars before @, domain with dot)
alter table public.waitlist
  add constraint waitlist_email_format
  check (email ~* '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$');
