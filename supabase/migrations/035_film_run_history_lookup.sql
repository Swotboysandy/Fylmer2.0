begin;
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.commit_film_run_job(uuid,uuid,text,jsonb,jsonb)'::regprocedure);
  if position('and inputs = previous->' in definition) = 0 then
    raise exception 'Expected history lookup not found.';
  end if;
  execute replace(definition, 'and inputs = previous->', 'and element_history.inputs = previous->');
end;
$$;
notify pgrst, 'reload schema';
commit;
