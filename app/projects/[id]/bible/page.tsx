import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { DotGrid } from "@/components/ui/dot-grid";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { assetText, characterNames, NARRATOR } from "@/lib/canvas/assets";
import { getElementBodyText } from "@/lib/canvas/osml-serializer";
import { isScene } from "@/lib/canvas/scenes";
import { deserializeWithScenes } from "@/lib/project/serialize";
import {
	SAVED_PROJECT_COLUMNS,
	parseSavedProject,
} from "@/lib/project/saved-project";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectBible({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	if (!z.guid().safeParse(id).success) notFound();

	const supabase = await createClient();
	const [
		{
			data: { user },
		},
		{ data: project, error },
	] = await Promise.all([
		supabase.auth.getUser(),
		supabase
			.from("projects")
			.select(SAVED_PROJECT_COLUMNS)
			.eq("id", id)
			.maybeSingle(),
	]);
	if (!user) redirect("/login");
	if (error) throw error;
	if (!project) notFound();

	const saved = parseSavedProject(project);
	const nodes = deserializeWithScenes(saved.script);
	const scenes = nodes.filter(isScene);
	const cast = [
		...new Set([
			...characterNames(nodes),
			...scenes.flatMap((scene) =>
				scene.children
					.filter((element) => element.type === "character")
					.map((element) => element.generationAttributes?.name)
					.filter((name): name is string => Boolean(name)),
			),
		]),
	].filter((name) => name !== NARRATOR);
	const { data: archive, error: archiveError } = await supabase
		.from("legacy_project_archives")
		.select("project_id")
		.eq("project_id", id)
		.maybeSingle();
	if (archiveError) throw archiveError;

	return (
		<main className="relative min-h-screen bg-background text-foreground">
			<DotGrid placement="container" />
			<div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10">
				<header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-7">
					<div>
						<Link
							href={`/projects/${id}`}
							className="text-label text-muted-foreground hover:text-foreground"
						>
							← Back to canvas
						</Link>
						<p className="mt-6 text-label text-muted-foreground">
							{saved.store.title || "Untitled project"}
						</p>
						<h1 className="mt-1 text-heading-lg font-semibold">
							Story & Film Bible
						</h1>
						<p className="mt-2 text-body text-muted-foreground">
							Your saved script, scenes, and characters in one place. Edit them
							on the canvas.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<ThemeToggle />
						<Button asChild variant="default">
							<Link href={`/projects/${id}`}>Open canvas</Link>
						</Button>
					</div>
				</header>

				{archive && (
					<p className="text-body text-muted-foreground">
						Looking for the original story and Film Bible?{" "}
						<Link
							href={`/projects/${id}/archive`}
							className="text-accent hover:underline"
						>
							View the original project
						</Link>
						.
					</p>
				)}

				<section aria-labelledby="script-heading" className="space-y-5">
					<div>
						<h2 id="script-heading" className="text-heading font-semibold">
							Script & scenes
						</h2>
						<p className="mt-1 text-label text-muted-foreground">
							{scenes.length} {scenes.length === 1 ? "scene" : "scenes"}
						</p>
					</div>
					{scenes.length === 0 ? (
						<p className="text-body text-muted-foreground">
							No scenes yet. Start your story on the canvas.
						</p>
					) : (
						scenes.map((scene, index) => (
							<article
								key={scene.id}
								className="rounded-xl border border-border bg-card p-5"
							>
								<h3 className="mb-4 text-heading-sm font-semibold">
									Scene {index + 1}
								</h3>
								<div className="space-y-4">
									{scene.children.map((element) => {
										const body = getElementBodyText(element).trim();
										if (!body) return null;
										const speaker =
											element.type === "character"
												? element.generationAttributes?.name || "Character"
												: element.type;
										return (
											<div key={element.id}>
												<p className="text-label font-medium capitalize text-muted-foreground">
													{speaker}
												</p>
												<p className="mt-1 whitespace-pre-wrap text-body">
													{body}
												</p>
											</div>
										);
									})}
								</div>
							</article>
						))
					)}
				</section>

				<section aria-labelledby="cast-heading" className="space-y-5">
					<div>
						<h2 id="cast-heading" className="text-heading font-semibold">
							Characters
						</h2>
						<p className="mt-1 text-label text-muted-foreground">
							{cast.length} {cast.length === 1 ? "character" : "characters"}
						</p>
					</div>
					{cast.length === 0 ? (
						<p className="text-body text-muted-foreground">
							No characters yet. Add them on the canvas.
						</p>
					) : (
						<div className="grid gap-3 sm:grid-cols-2">
							{cast.map((name) => {
								const description =
									assetText(nodes, "asset_avatar", name) ||
									assetText(nodes, "asset_voice", name);
								return (
									<article
										key={name}
										className="rounded-xl border border-border bg-card p-5"
									>
										<h3 className="text-body font-semibold">{name}</h3>
										{description && (
											<p className="mt-2 whitespace-pre-wrap text-body text-muted-foreground">
												{description}
											</p>
										)}
									</article>
								);
							})}
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
