"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { ProjectRow } from "@/lib/project/api";
import { ImageWithShimmer } from "@/lib/components/image-with-shimmer";
import { DeleteButton } from "@/components/ui/delete-button";
import { relativeTime } from "@/lib/project/relative-time";

export function ProjectCard({
	project,
	onDelete,
	legacy = false,
	mediaCounts,
}: {
	project: ProjectRow;
	onDelete: () => void;
	legacy?: boolean;
	mediaCounts?: { images: number; videos: number };
}) {
	const href = `/projects/${project.id}`;
	const reducedMotion = useReducedMotion();

	return (
		<li className="group">
			<motion.div
				className="relative"
				whileHover={
					reducedMotion ? undefined : { transform: "translateY(-2px)" }
				}
				whileTap={reducedMotion ? undefined : { transform: "scale(0.985)" }}
				transition={{ duration: 0.16, ease: "easeOut" }}
			>
				<Link
					href={href}
					aria-label={`Open ${project.name}`}
					className="block w-full overflow-hidden rounded-lg bg-muted focus-ring"
				>
					<div className="relative aspect-square">
						{project.thumbnail_url ? (
							<ImageWithShimmer
								src={project.thumbnail_url}
								alt={project.name}
								fill
								unoptimized={legacy}
								sizes="(min-width: 1280px) 200px, (min-width: 768px) 25vw, 50vw"
								className="object-cover transition-transform duration-200 ease-out motion-safe:group-hover:scale-[1.02]"
							/>
						) : (
							<div className="absolute inset-0 flex items-center justify-center text-label text-muted-foreground">
								No preview
							</div>
						)}
					</div>
				</Link>
				{!legacy && (
					<div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
						<DeleteButton
							ariaLabel={`Delete ${project.name}`}
							onClick={onDelete}
						/>
					</div>
				)}
			</motion.div>
			<Link href={href} className="mt-2 block w-full text-left">
				<div className="truncate text-body font-semibold text-foreground">
					{project.name}
				</div>
				<div
					className="mt-0.5 truncate text-label text-muted-foreground"
					suppressHydrationWarning
				>
					Edited {relativeTime(project.updated_at)}
				</div>
			</Link>
			{legacy &&
				mediaCounts &&
				(mediaCounts.images > 0 || mediaCounts.videos > 0) && (
					<p className="mt-1 text-label text-muted-foreground">
						{[
							mediaCounts.images &&
								`${mediaCounts.images} ${mediaCounts.images === 1 ? "image" : "images"}`,
							mediaCounts.videos &&
								`${mediaCounts.videos} ${mediaCounts.videos === 1 ? "video" : "videos"}`,
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				)}
			{legacy && (
				<Link
					href={`${href}/archive`}
					className="mt-1 block text-label text-muted-foreground hover:text-foreground"
				>
					Original project · images and videos
				</Link>
			)}
		</li>
	);
}
