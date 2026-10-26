import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { DotGrid } from "@/components/ui/dot-grid";
import { ImageWithShimmer } from "@/lib/components/image-with-shimmer";
import { createClient } from "@/lib/supabase/server";

const Snapshot = z.record(
	z.string(),
	z.array(z.record(z.string(), z.unknown())),
);
type Row = Record<string, unknown>;

const value = (row: Row, key: string) =>
	typeof row[key] === "string" ? row[key] : "";
const rows = (snapshot: z.infer<typeof Snapshot>, table: string) =>
	snapshot[table] ?? [];
const mediaUrl = (url: string) =>
	/^\/(?:oss|direkta|quiet-star|maurya)\/[A-Za-z0-9._/-]+$/.test(url) &&
	!url.includes("..")
		? url
		: null;

export default async function LegacyProjectArchive({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	if (!z.uuid().safeParse(id).success) notFound();
	const client = await createClient();
	const {
		data: { user },
	} = await client.auth.getUser();
	if (!user) redirect("/login");
	const { data, error } = await client
		.from("legacy_project_archives")
		.select("snapshot")
		.eq("project_id", id)
		.maybeSingle();
	if (error) throw error;
	if (!data) notFound();
	const snapshot = Snapshot.parse(data.snapshot);
	const project = rows(snapshot, "projects")[0];
	if (!project) notFound();
	const cast = rows(snapshot, "characters");
	const places = rows(snapshot, "locations");
	const graph = rows(snapshot, "nodes");
	const media = rows(snapshot, "assets").filter(
		(asset) =>
			["image", "video"].includes(value(asset, "kind")) &&
			mediaUrl(value(asset, "url")),
	);
	const bible = rows(snapshot, "bible")[0];
	return (
		<main className="relative min-h-screen bg-background text-foreground">
			<DotGrid placement="container" />
			<div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10">
				<header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-7">
					<div className="max-w-3xl">
						<Link
							href={`/projects/${id}`}
							className="text-label text-muted-foreground hover:text-foreground"
						>
							← Back to editor
						</Link>
						<p className="mt-6 text-label font-medium text-muted-foreground">
							Original Fylmer project
						</p>
						<h1 className="mt-1 text-heading-lg font-semibold tracking-tight">
							{value(project, "title")}
						</h1>
						<p className="mt-2 text-body text-muted-foreground">
							Your original story, cast, plans and generated media are preserved
							here. Edit the working copy in the Canvas.
						</p>
					</div>
					<Button asChild variant="default">
						<Link href={`/projects/${id}`}>Open working copy</Link>
					</Button>
				</header>
				<section
					className="max-w-3xl space-y-4"
					aria-labelledby="story-heading"
				>
					<h2 id="story-heading" className="text-heading font-semibold">
						Story
					</h2>
					{["logline", "premise", "short_synopsis", "script"].map(
						(key) =>
							value(project, key) && (
								<p
									key={key}
									className="whitespace-pre-wrap text-body text-muted-foreground"
								>
									{value(project, key)}
								</p>
							),
					)}
					{bible && (
						<div className="space-y-3 border-t border-border pt-5">
							<h3 className="text-heading-sm font-semibold">Film Bible</h3>
							{["world_doc", "tone_doc", "characters_doc"].map(
								(key) =>
									value(bible, key) && (
										<p
											key={key}
											className="whitespace-pre-wrap text-body text-muted-foreground"
										>
											{value(bible, key)}
										</p>
									),
							)}
						</div>
					)}
				</section>
				<section aria-labelledby="cast-heading">
					<h2 id="cast-heading" className="mb-4 text-heading font-semibold">
						Characters · {cast.length}
					</h2>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{cast.map((character) => (
							<article
								key={value(character, "id")}
								className="rounded-xl border border-border bg-card p-4"
							>
								<h3 className="text-body font-semibold">
									{value(character, "name")}
								</h3>
								<p className="text-label text-muted-foreground">
									{value(character, "role")}
								</p>
								{value(character, "background") && (
									<p className="mt-2 text-label text-muted-foreground">
										{value(character, "background")}
									</p>
								)}
							</article>
						))}
					</div>
				</section>
				<section aria-labelledby="places-heading">
					<h2 id="places-heading" className="mb-4 text-heading font-semibold">
						Places · {places.length}
					</h2>
					<div className="flex flex-wrap gap-2">
						{places.map((place) => (
							<span
								key={value(place, "id")}
								className="rounded-md border border-border bg-card px-3 py-2 text-label"
							>
								{value(place, "name")}
							</span>
						))}
					</div>
				</section>
				<section aria-labelledby="graph-heading">
					<h2 id="graph-heading" className="mb-4 text-heading font-semibold">
						Original story map · {graph.length} nodes
					</h2>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{graph.map((node) => (
							<article
								key={value(node, "id")}
								className="rounded-xl border border-border bg-card p-4"
							>
								<h3 className="text-body font-semibold">
									{value(node, "title")}
								</h3>
								{value(node, "body") && (
									<p className="mt-2 line-clamp-5 whitespace-pre-wrap text-label text-muted-foreground">
										{value(node, "body")}
									</p>
								)}
							</article>
						))}
					</div>
				</section>
				<section aria-labelledby="media-heading">
					<h2 id="media-heading" className="mb-4 text-heading font-semibold">
						Generated images and videos · {media.length}
					</h2>
					{media.length === 0 ? (
						<p className="text-body text-muted-foreground">
							No media is linked to this project.
						</p>
					) : (
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{media.map((asset) => {
								const url = mediaUrl(value(asset, "url"));
								if (!url) return null;
								return (
									<article
										key={value(asset, "id")}
										className="overflow-hidden rounded-xl border border-border bg-card"
									>
										<div className="relative aspect-video bg-muted">
											{value(asset, "kind") === "video" ? (
												<video
													src={url}
													controls
													preload="none"
													className="h-full w-full object-contain"
												/>
											) : (
												<ImageWithShimmer
													src={url}
													alt={value(asset, "prompt") || "Generated image"}
													fill
													unoptimized
													sizes="(min-width: 1024px) 33vw, 100vw"
													className="object-cover"
												/>
											)}
										</div>
										<div className="p-3">
											<p className="text-label font-medium capitalize">
												{value(asset, "kind")}
											</p>
											{value(asset, "prompt") && (
												<p className="mt-1 line-clamp-3 text-label text-muted-foreground">
													{value(asset, "prompt")}
												</p>
											)}
										</div>
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
