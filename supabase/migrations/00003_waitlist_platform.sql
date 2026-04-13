-- supabase/migrations/00003_waitlist_platform.sql
ALTER TABLE public.waitlist ADD COLUMN platform text;
