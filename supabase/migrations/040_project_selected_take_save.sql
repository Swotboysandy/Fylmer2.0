begin;

create function public.film_selected_generation(p_generation jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(entry.key, jsonb_build_object(
    'result', entry.value->'result',
    'resultInputs', entry.value->'resultInputs',
    'connectorType', entry.value->'connectorType',
    'pinned', coalesce(entry.value->'pinned', 'false'::jsonb)
  )), '{}'::jsonb)
  from jsonb_each(p_generation) entry
  where entry.value->'result' is not null and entry.value->'result' <> 'null'::jsonb;
$$;

create function public.save_project_snapshot(
  p_project_id uuid, p_expected_generation jsonb, p_script text, p_store jsonb,
  p_generation jsonb, p_name text, p_thumbnail_url text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  current_takes jsonb;
begin
  select * into project from public.projects where id = p_project_id and user_id = auth.uid() for update;
  if not found then raise exception 'FYLMER_SAVE: Project not found.'; end if;
  if p_script is null or p_name is null or jsonb_typeof(p_store) is distinct from 'object'
    or jsonb_typeof(p_generation) is distinct from 'object'
    or jsonb_typeof(p_expected_generation) is distinct from 'object' then
    raise exception 'FYLMER_SAVE: Invalid project snapshot.';
  end if;
  current_takes := public.film_selected_generation(project.generation);
  if current_takes is distinct from public.film_selected_generation(p_expected_generation)
    and current_takes is distinct from public.film_selected_generation(p_generation) then
    raise exception 'FYLMER_SAVE: Background media changed. Refresh the project before saving to keep its selected takes.';
  end if;
  update public.projects set script = p_script, store = p_store, generation = p_generation,
    name = p_name, thumbnail_url = p_thumbnail_url where id = p_project_id;
end;
$$;

revoke all on function public.film_selected_generation(jsonb) from public, anon, authenticated;
revoke all on function public.save_project_snapshot(uuid, jsonb, text, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.save_project_snapshot(uuid, jsonb, text, jsonb, jsonb, text, text) to authenticated;
notify pgrst, 'reload schema';
commit;
