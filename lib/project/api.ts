import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { selectColumns } from "@/lib/supabase/select-columns";
import type { ProjectMeta } from "./project-document";
import type { SavedProject } from "./saved-project";
import { parseSavedProject, SAVED_PROJECT_COLUMNS } from "./saved-project";

export const ProjectRowSchema = z.object({
	id: z.string(),
	name: z.string(),
	thumbnail_url: z.string().nullable(),
	updated_at: z.string(),
});

export type ProjectRow = z.infer<typeof ProjectRowSchema>;

export const PROJECT_ROW_COLUMNS = selectColumns(ProjectRowSchema);

export type SaveProjectInput = SavedProject & ProjectMeta;

export async function readProjectSnapshot(
	id: string,
	signal: AbortSignal,
): Promise<SavedProject> {
	const { data, error } = await createClient()
		.from("projects")
		.select(SAVED_PROJECT_COLUMNS)
		.eq("id", id)
		.abortSignal(AbortSignal.any([signal, AbortSignal.timeout(10000)]))
		.single();
	if (error) throw error;
	return parseSavedProject(data);
}

export async function createProject(): Promise<ProjectRow> {
	const supabase = createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) throw new Error("Not authenticated");
	const { data, error } = await supabase
		.from("projects")
		.insert({ user_id: user.id })
		.select(PROJECT_ROW_COLUMNS)
		.single();
	if (error) throw error;
	return ProjectRowSchema.parse(data);
}

export async function deleteProject(id: string): Promise<void> {
	const supabase = createClient();
	const { error } = await supabase.from("projects").delete().eq("id", id);
	if (error) throw error;
}

export async function saveProject(
	id: string,
	input: SaveProjectInput,
	expectedGeneration: SavedProject["generation"],
): Promise<void> {
	const supabase = createClient();
	const { error } = await supabase.rpc("save_project_snapshot", {
		p_project_id: id,
		p_expected_generation: expectedGeneration,
		p_script: input.script,
		p_store: input.store,
		p_generation: input.generation,
		p_name: input.name,
		p_thumbnail_url: input.thumbnail_url,
	});
	if (error) {
		if (error.message.startsWith("FYLMER_SAVE:"))
			throw new Error(error.message.slice("FYLMER_SAVE:".length).trim());
		throw error;
	}
}
