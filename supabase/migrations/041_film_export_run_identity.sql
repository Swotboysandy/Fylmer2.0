begin;

create or replace function public.film_export_snapshot(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  project public.projects%rowtype;
  review jsonb;
  approval_hash text;
  matching_run uuid;
begin
  select * into project from public.projects where id = p_project_id and user_id = auth.uid() for update;
  if not found then raise exception 'FYLMER_EXPORT: Project not found or unavailable to this account.'; end if;
  review := public.film_workflow(p_project_id, 'read');
  if not coalesce((review->>'finalCut')::boolean, false) then
    raise exception 'FYLMER_EXPORT: Review and approve the current final cut in Film Bible before exporting.';
  end if;
  select final_cut into approval_hash from public.film_reviews where project_id = p_project_id;
  select run.id into matching_run from public.film_runs run
    where run.project_id = project.id and run.user_id = auth.uid()
      and run.status = 'paused' and run.coordinator_stop = 'final_review'
      and run.source_hash = md5(project.script || project.store::text)
      and run.mode = review->>'mode'
      and run.planned_generation = project.generation
      and jsonb_array_length(run.plan->'nodes') > 0
      and not exists (
        select 1 from jsonb_array_elements(run.plan->'nodes') node
        where node->>'action' = 'generate' and not exists (
          select 1 from public.film_run_jobs binding
          where binding.run_id = run.id and binding.node_id = node->>'id'
            and binding.committed_at is not null
        )
      );
  return jsonb_build_object(
    'projectId', project.id,
    'approvalHash', approval_hash,
    'runId', matching_run,
    'project', jsonb_build_object('script', project.script, 'store', project.store, 'generation', project.generation)
  );
end;
$$;

revoke all on function public.film_export_snapshot(uuid) from public, anon;
grant execute on function public.film_export_snapshot(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
