begin;
alter table public.film_run_jobs alter constraint film_run_jobs_job_id_fkey deferrable initially deferred;
commit;
