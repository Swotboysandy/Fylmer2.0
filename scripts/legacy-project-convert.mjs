import { v5 as uuidv5 } from "uuid";

const namespace = "368076a3-5978-472f-99fd-7da6d52d786b";
const escapeXml = (value) =>
	String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

export function convertedProjectId(legacyId) {
	return uuidv5(`fylmer-legacy-project:${legacyId}`, namespace);
}

export function convertLegacyProject(archive) {
	const project = archive.snapshot.projects[0];
	const characters = archive.snapshot.characters ?? [];
	const nodes = archive.snapshot.nodes ?? [];
	const beats = [...(archive.snapshot.beats ?? [])].sort(
		(first, second) => Number(first.n) - Number(second.n),
	);
	const variants = archive.snapshot.storyboard_variants ?? [];
	const runs = [...(archive.snapshot.film_runs ?? [])].sort((first, second) =>
		String(second.created_at).localeCompare(String(first.created_at)),
	);
	const shots = [...(archive.snapshot.film_run_shots ?? [])]
		.filter((shot) => shot.run_id === runs[0]?.id)
		.sort((first, second) => Number(first.ordinal) - Number(second.ordinal));
	const summary = [
		project.logline,
		project.premise,
		project.short_synopsis,
		project.script,
	]
		.map((text) => String(text ?? "").trim())
		.filter(Boolean)
		.filter((text, index, all) => all.indexOf(text) === index)
		.join("\n\n");
	const cast = characters.map((character) => {
		const description = [character.name, character.role, character.background]
			.filter(Boolean)
			.join(" — ");
		return `<asset_avatar id="${escapeXml(character.id)}" name="${escapeXml(character.name)}">${escapeXml(description)}</asset_avatar>`;
	});
	const story = [
		"--- Scene 1 ---",
		`<narration id="legacy-story">${escapeXml(summary || project.title)}</narration>`,
	];
	let sceneNumber = 1;
	let sceneHeading = "";
	for (const beat of beats) {
		if (beat.scene_heading && beat.scene_heading !== sceneHeading) {
			sceneHeading = beat.scene_heading;
			sceneNumber += 1;
			story.push(`--- Scene ${sceneNumber} ---`);
		}
		story.push(
			`<narration id="${escapeXml(beat.id)}">${escapeXml([beat.scene_heading, beat.title, beat.summary, beat.direction].filter(Boolean).join(" — "))}</narration>`,
		);
		for (const variant of variants.filter(
			(candidate) => candidate.beat_id === beat.id,
		))
			story.push(
				`<image id="${escapeXml(variant.id)}">${escapeXml(variant.prompt || beat.summary || beat.title || "Original storyboard image")}</image>`,
			);
	}
	for (const node of nodes.filter(
		(candidate) =>
			candidate.kind === "storyboard" || candidate.kind === "render",
	)) {
		const tag = node.kind === "render" ? "video" : "image";
		story.push(
			`<${tag} id="${escapeXml(node.id)}">${escapeXml([node.title, node.body].filter(Boolean).join(" — "))}</${tag}>`,
		);
	}
	if (shots.length) {
		story.push(`--- Scene ${sceneNumber + 1} ---`);
		for (const shot of shots) {
			let direction = {};
			try {
				direction = JSON.parse(shot.shot_json || "{}");
			} catch {
				direction = {};
			}
			story.push(
				`<video id="${escapeXml(shot.id)}">${escapeXml([`Scene ${shot.scene_number}, shot ${shot.shot_number}`, direction.action, direction.shotSize, direction.cameraMovement].filter(Boolean).join(" — "))}</video>`,
			);
		}
	}
	const image = (archive.snapshot.assets ?? []).find(
		(asset) =>
			asset.kind === "image" &&
			/^\/(?:oss|direkta|quiet-star|maurya)\/[A-Za-z0-9._/-]+$/.test(
				asset.url,
			) &&
			!asset.url.includes(".."),
	);
	const aspectRatio = ["16:9", "9:16", "1:1", "4:5", "21:9"].includes(
		project.aspect_ratio,
	)
		? project.aspect_ratio
		: "16:9";
	return {
		id: convertedProjectId(project.id),
		name: project.title,
		thumbnail_url: image?.url ?? null,
		script: [...cast, ...story].join("\n"),
		store: { title: project.title, videoSettings: { aspectRatio } },
		generation: {},
	};
}
