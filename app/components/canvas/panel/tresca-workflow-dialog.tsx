"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	MountedDialog,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	parseComfyDocument,
	type ComfyDocument,
} from "@/lib/fylmer/comfy-document";
import { buildH3Workflow } from "@/lib/fylmer/h3-workflow";
import { useProjectId } from "@/lib/project/project-provider";

type Settings = {
	prompt: string;
	width: string;
	height: string;
	frames: string;
	seed: string;
	steps: string;
};

function settingsFrom(document: ComfyDocument): Settings {
	const imageToVideo = document.prompt["5"]?.inputs;
	const sampler = document.prompt["8"]?.inputs;
	if (!imageToVideo || !sampler)
		throw new Error("This project has no supported Tresca base workflow.");
	return {
		prompt: String(imageToVideo.prompt ?? "").split(
			"\n\nPRODUCTION CONSTRAINTS:",
		)[0],
		width: String(imageToVideo.width ?? ""),
		height: String(imageToVideo.height ?? ""),
		frames: String(imageToVideo.length ?? ""),
		seed: String(sampler.seed ?? ""),
		steps: String(sampler.steps ?? ""),
	};
}

function workflowFrom(settings: Settings): ComfyDocument {
	if (!settings.seed || !settings.steps || !settings.frames)
		throw new Error("Enter a seed, sampling steps and frame count.");
	const { workflow } = buildH3Workflow({
		prompt: settings.prompt,
		width: Number(settings.width),
		height: Number(settings.height),
		durationSeconds: Math.min(15, Number(settings.frames) / 24),
		seed: Number(settings.seed),
		steps: Number(settings.steps),
	});
	if (String(workflow["5"].inputs.length) !== settings.frames)
		throw new Error("Choose a supported frame count (5, 22, 39… up to 362).");
	return parseComfyDocument(workflow);
}

async function workflowRequest(payload: Record<string, unknown>) {
	const response = await fetch("/api/tresca-workflow", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	const result = await response.json();
	if (!response.ok)
		throw new Error(result.error ?? "Could not save the Tresca workflow.");
	return result;
}

export function TrescaWorkflowDialog() {
	const projectId = useProjectId();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				size="sm"
				variant="panel"
				className="w-full shrink-0"
				onClick={() => setOpen(true)}
			>
				Advanced Tresca Canvas
			</Button>
			<MountedDialog open={open} onOpenChange={setOpen}>
				<TrescaWorkflowEditor
					projectId={projectId}
					close={() => setOpen(false)}
				/>
			</MountedDialog>
		</>
	);
}

function TrescaWorkflowEditor({
	projectId,
	close,
}: {
	projectId: string;
	close: () => void;
}) {
	const [settings, setSettings] = useState<Settings | null>(null);
	const [version, setVersion] = useState(0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);
	useEffect(() => {
		let active = true;
		(async () => {
			try {
				const current = await workflowRequest({ projectId, action: "read" });
				const source =
					current.document ??
					(await workflowRequest({ projectId, action: "template" })).document;
				if (active) {
					setVersion(current.version);
					setSettings(settingsFrom(parseComfyDocument(source)));
				}
			} catch (failure) {
				if (active)
					setError(
						failure instanceof Error
							? failure.message
							: "Could not load workflow.",
					);
			}
		})();
		return () => {
			active = false;
		};
	}, [projectId]);
	const preview = useMemo(() => {
		if (!settings) return null;
		try {
			return { document: workflowFrom(settings), error: "" };
		} catch (failure) {
			return {
				document: null,
				error: failure instanceof Error ? failure.message : "Invalid settings.",
			};
		}
	}, [settings]);
	async function save() {
		if (!preview?.document) return;
		setBusy(true);
		setError("");
		try {
			const result = await workflowRequest({
				projectId,
				action: "save",
				version,
				document: preview.document,
			});
			setVersion(result.version);
			setSaved(true);
		} catch (failure) {
			setError(
				failure instanceof Error ? failure.message : "Could not save workflow.",
			);
		} finally {
			setBusy(false);
		}
	}
	const field = (key: Exclude<keyof Settings, "prompt">, label: string) => (
		<label className="flex flex-col gap-1 text-label text-foreground" key={key}>
			{label}
			<Input
				size="sm"
				type="number"
				value={settings?.[key] ?? ""}
				onChange={(event) => {
					setSaved(false);
					setSettings(
						(current) => current && { ...current, [key]: event.target.value },
					);
				}}
			/>
		</label>
	);
	return (
		<DialogContent className="max-w-3xl">
			<DialogHeader>
				<DialogTitle>Tresca Canvas</DialogTitle>
				<DialogDescription>
					Adjust the real H3 base workflow for this project. GPU generation
					remains off.
				</DialogDescription>
			</DialogHeader>
			<DialogBody>
				{settings && (
					<>
						<label className="flex flex-col gap-1 text-label text-foreground">
							Shot direction
							<Textarea
								value={settings.prompt}
								onChange={(event) => {
									setSaved(false);
									setSettings({ ...settings, prompt: event.target.value });
								}}
							/>
						</label>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
							{field("width", "Width")}
							{field("height", "Height")}
							{field("frames", "Frames at 24 fps")}
							{field("seed", "Seed")}
							{field("steps", "Sampling steps")}
						</div>
						{preview?.document && (
							<div className="flex flex-col gap-2">
								<h3 className="text-label font-semibold text-foreground">
									Connected nodes
								</h3>
								<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
									{Object.entries(preview.document.prompt).map(([id, node]) => (
										<div
											key={id}
											className="rounded-md border border-border bg-card p-2 text-label"
										>
											<p className="font-medium text-foreground">
												{id} · {node.class_type}
											</p>
											<p className="text-muted-foreground">
												{Object.entries(node.inputs)
													.flatMap(([name, input]) =>
														Array.isArray(input) && input.length === 2
															? [`${name} ← ${input[0]}`]
															: [],
													)
													.join(" · ") || "Source node"}
											</p>
										</div>
									))}
								</div>
							</div>
						)}
					</>
				)}
				{preview?.error && (
					<p role="alert" className="text-label text-destructive">
						{preview.error}
					</p>
				)}
				{error && (
					<p role="alert" className="text-label text-destructive">
						{error}
					</p>
				)}
				{saved && (
					<p role="status" className="text-label text-muted-foreground">
						Saved as project workflow version {version}.
					</p>
				)}
			</DialogBody>
			<DialogFooter>
				<Button variant="secondary" onClick={close}>
					Close
				</Button>
				<Button
					variant="default"
					disabled={!preview?.document || busy}
					onClick={() => void save()}
				>
					{busy ? "Saving…" : "Save workflow"}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}
