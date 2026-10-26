"use client";

import { useId, useState } from "react";
import { useSlate } from "slate-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { getContentElements } from "@/lib/canvas/scenes";
import {
	useGenerationQueue,
	useQueueSelector,
} from "@/lib/generation/generation-queue-provider";
import { useProjectId } from "@/lib/project/project-provider";
import { PanelCard } from "./panel-card";

function MusicRightsForm({
	elementId,
	audioUrl,
	number,
}: {
	elementId: string;
	audioUrl: string;
	number: number;
}) {
	const queue = useGenerationQueue();
	const snapshot = useQueueSelector((store) =>
		store.getElementSnapshot(elementId),
	);
	const existing = snapshot.result?.musicRights;
	const id = useId();
	const [basis, setBasis] = useState<"original" | "licensed" | "public-domain">(
		existing?.basis ?? "original",
	);
	const [statement, setStatement] = useState(existing?.statement ?? "");
	const [evidence, setEvidence] = useState(existing?.evidence ?? "");
	const [confirmed, setConfirmed] = useState(false);
	const [error, setError] = useState("");
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				setError("");
				if (!confirmed) return;
				try {
					queue.setMusicRights(elementId, audioUrl, {
						status: "user-declared",
						audioUrl,
						basis,
						statement,
						evidence,
						declaredAt: new Date().toISOString(),
					});
					setConfirmed(false);
				} catch (failure) {
					setError(
						failure instanceof Error
							? failure.message
							: "Could not update music rights.",
					);
				}
			}}
		>
			<p className="text-label">
				Track {number} ·{" "}
				{existing ? "User-declared rights" : "Rights not documented"}
			</p>
			<SelectField
				value={basis}
				onChange={setBasis}
				ariaLabel={`Track ${number} rights basis`}
				options={[
					{ value: "original", label: "My original recording" },
					{ value: "licensed", label: "Licensed recording" },
					{ value: "public-domain", label: "Public-domain recording" },
				]}
			/>
			<label htmlFor={`${id}-statement`} className="text-label">
				What permits you to use this recording?
			</label>
			<Input
				id={`${id}-statement`}
				required
				maxLength={2000}
				value={statement}
				onChange={(event) => setStatement(event.target.value)}
				aria-describedby={`${id}-help`}
			/>
			<label htmlFor={`${id}-evidence`} className="text-label">
				License or ownership evidence reference
			</label>
			<Input
				id={`${id}-evidence`}
				required
				maxLength={2000}
				value={evidence}
				onChange={(event) => setEvidence(event.target.value)}
				aria-describedby={`${id}-help`}
			/>
			<p id={`${id}-help`} className="text-label text-muted-foreground">
				Record the license, receipt or original recording reference. Do not
				enter passwords or keys. Fylmer does not independently verify this
				declaration.
			</p>
			<label className="flex items-start gap-2 text-label">
				<input
					type="checkbox"
					required
					checked={confirmed}
					onChange={(event) => setConfirmed(event.target.checked)}
				/>
				I confirm this declaration applies to this selected recording.
			</label>
			{error && (
				<p role="alert" className="text-label text-destructive">
					{error}
				</p>
			)}
			<Button
				type="submit"
				size="sm"
				variant="panel"
				disabled={
					snapshot.status !== "idle" ||
					!confirmed ||
					!statement.trim() ||
					!evidence.trim()
				}
			>
				Apply declaration
			</Button>
			<p className="text-label text-muted-foreground">
				Wait for project saving to finish, then refresh review and approve the
				final cut again.
			</p>
		</form>
	);
}

export function MusicRightsCard() {
	const editor = useSlate();
	const queue = useGenerationQueue();
	const projectId = useProjectId();
	useQueueSelector((store) => store.getResultVersion());
	const tracks = getContentElements(editor.children)
		.filter((element) => element.type === "music")
		.flatMap((element) => {
			const result = queue.getElementSnapshot(element.id).result;
			return result?.audioUrl
				? [
						{
							id: element.id,
							audioUrl: result.audioUrl,
							declaredAt: result.musicRights?.declaredAt,
						},
					]
				: [];
		});
	return (
		<PanelCard title="Music rights">
			{tracks.length ? (
				tracks.map((track, index) => (
					<MusicRightsForm
						key={`${projectId}:${track.id}:${track.audioUrl}:${track.declaredAt ?? "unknown"}`}
						elementId={track.id}
						audioUrl={track.audioUrl}
						number={index + 1}
					/>
				))
			) : (
				<p className="text-label text-muted-foreground">
					No selected music tracks. Narration and sound effects are unchanged.
				</p>
			)}
		</PanelCard>
	);
}
