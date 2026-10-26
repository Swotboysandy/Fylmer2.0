"use client";

import { useRef, useState } from "react";
import {
	CornerDownLeft,
	FilmSlate,
	Hourglass,
	ImagePlus,
	Loader2,
	Mic,
	Palette,
	Plus,
	Proportions,
	Translate,
	User,
	X,
} from "@/components/ui/icon";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import {
	SegmentedControl,
	type SegmentedControlOption,
} from "@/components/ui/segmented-control";
import AnimatedPlaceholder from "@/app/components/animated-placeholder";
import { useAssetEditors } from "@/app/components/canvas/elements/character/asset-edit-provider";
import { TEMPLATES, type Template } from "@/lib/templates/templates";
import { templateBrief } from "@/lib/templates/template-brief";
import { useTemplate } from "@/lib/templates/use-template";
import { useReferenceImages } from "@/app/components/canvas/hooks/use-reference-images";
import { useProject } from "@/lib/project/use-project";
import { NARRATOR } from "@/lib/canvas/assets";
import {
	LANGUAGE_CHOICES,
	languageLabel,
	type LanguageChoice,
} from "@/lib/project/language";
import { useDefaultModels } from "@/lib/connectors/use-default-models";
import {
	ASPECT_RATIOS,
	DEFAULT_ASPECT_RATIO,
	type AspectRatio,
} from "@/lib/project/aspect-ratio";
import {
	inferBriefSettings,
	reconcileBriefSetting,
	type AutoSetting,
	type BriefSettings,
} from "@/lib/project/brief-settings";
import { useVideoSetting } from "@/lib/project/use-video-setting";
import {
	VIDEO_LENGTHS,
	DEFAULT_VIDEO_LENGTH,
	videoLengthLabel,
	type VideoLength,
} from "@/lib/project/video-length";
import {
	VIDEO_FORMAT_CHOICES,
	DEFAULT_VIDEO_FORMAT,
	videoFormatLabel,
	videoFormatSummary,
	type VideoFormat,
} from "@/lib/project/video-format";
import { useFileUpload } from "@/lib/upload/use-file-upload";
import { cn } from "@/lib/utils";
import { ActionButton } from "./action-button";
import { AssetStrip } from "@/app/components/canvas/elements/asset-strip";
import {
	SettingPill,
	SettingPillButton,
	type SettingPillOption,
} from "./setting-pill";
import { ModelSelect, modelLabel } from "@/app/components/models/model-select";
import { ProviderIcon } from "@/app/components/models/provider-icon";

/** What the user says they are giving us. Presentation only: Sloppy reads the text itself. */
export type ComposerIntent = "story" | "script";

const INTENT_OPTIONS: SegmentedControlOption<ComposerIntent>[] = [
	{ value: "story", label: "Describe a video" },
	{ value: "script", label: "Paste a script" },
];

const SCRIPT_PLACEHOLDER = `EXT. NIGHT STARRY SKY
Soft glowing stars twinkle quietly across a deep blue sky.
A large silver moon glows softly above peaceful clouds.
Gentle music begins.

NARRATOR (soft, soothing voice)
High above the quiet forests and sleepy hills…
past the drifting clouds…
there was a small glowing garden hidden on the moon.

And in that garden… lived a little rabbit named Lumi…`;

const ASPECT_RATIO_OPTIONS: SettingPillOption<AspectRatio>[] =
	ASPECT_RATIOS.map((value) => ({ value, label: value }));

const VIDEO_LENGTH_OPTIONS: SettingPillOption<VideoLength>[] =
	VIDEO_LENGTHS.map((value) => ({ value, label: videoLengthLabel(value) }));

const VIDEO_FORMAT_OPTIONS: SettingPillOption<VideoFormat>[] =
	VIDEO_FORMAT_CHOICES.map((value) => ({
		value,
		label: videoFormatLabel(value),
		description: videoFormatSummary(value),
	}));

const LANGUAGE_OPTIONS: SettingPillOption<LanguageChoice>[] =
	LANGUAGE_CHOICES.map((value) => ({ value, label: languageLabel(value) }));

const TEMPLATE_OPTIONS: SettingPillOption<string>[] = TEMPLATES.map(
	({ id, name }) => ({ value: id, label: name }),
);

function AttachMenu({
	openPicker,
	uploading,
}: {
	openPicker: () => void;
	uploading: boolean;
}) {
	const { openCreateCharacter, editAsset } = useAssetEditors();
	const iconClass = "mr-1.5 h-3.5 w-3.5 text-foreground";
	const items: ActionMenuItem[] = [
		{
			key: "upload",
			label: "Upload reference images",
			icon: <ImagePlus className={iconClass} />,
			onSelect: openPicker,
		},
		{
			key: "character",
			label: "Create character",
			icon: <User className={iconClass} />,
			onSelect: openCreateCharacter,
		},
		{
			key: "narrator",
			label: "Select narrator voice",
			icon: <Mic className={iconClass} />,
			onSelect: () => editAsset("asset_voice", NARRATOR),
		},
		{
			key: "art-style",
			label: "Set art style",
			icon: <Palette className={iconClass} />,
			onSelect: () => editAsset("asset_style"),
		},
	];

	return (
		<ActionMenu
			items={items}
			contentClassName="min-w-36 p-0.5"
			itemClassName="rounded-lg text-label-xs"
		>
			<button
				type="button"
				aria-label="Attach"
				disabled={uploading}
				className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-button-hover disabled:pointer-events-none"
			>
				{uploading ? (
					<Loader2 className="h-4 w-4 animate-spin" />
				) : (
					<Plus className="h-4 w-4" />
				)}
			</button>
		</ActionMenu>
	);
}

function TemplatePill({
	template,
	onRemove,
}: {
	template: Template;
	onRemove: () => void;
}) {
	return (
		<span
			className="relative inline-flex self-start shrink-0 items-center gap-1 overflow-hidden rounded-full py-0.5 pl-1 pr-2 font-body text-body text-foreground whitespace-nowrap sm:mt-px sm:self-auto"
			style={{ backgroundColor: template.color }}
		>
			<button
				type="button"
				aria-label="Remove template"
				onClick={onRemove}
				className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-on-media/20"
			>
				<X className="h-3 w-3" />
			</button>
			{template.promptPrefix}
		</span>
	);
}

interface ComposerCopilotProps {
	value: string;
	onValueChange: (value: string) => void;
	onSubmit: (brief: string, intent: ComposerIntent) => void;
	busy?: boolean;
}

export default function ComposerCopilot({
	value,
	onValueChange,
	onSubmit,
	busy = false,
}: ComposerCopilotProps) {
	const [intent, setIntent] = useState<ComposerIntent>("story");
	const { template, applyTemplate, clearTemplate } = useTemplate();
	const aspectRatio = useVideoSetting("aspectRatio");
	const updateVideoSettings = useProject((state) => state.updateVideoSettings);
	const updateModels = useProject((state) => state.updateModels);
	const updateScriptSettings = useProject(
		(state) => state.updateScriptSettings,
	);
	const {
		length: videoLength,
		format: videoFormat,
		language,
	} = useProject((state) => state.scriptSettings);
	const { add: addReferenceImages } = useReferenceImages();
	const model = useDefaultModels().llm;
	const automatic = useRef<{
		aspectRatio?: AutoSetting<AspectRatio>;
		format?: AutoSetting<VideoFormat>;
		language?: AutoSetting<LanguageChoice>;
		length?: AutoSetting<VideoLength>;
	}>({});
	const manual = useRef<Record<keyof BriefSettings, boolean>>({
		aspectRatio: aspectRatio !== DEFAULT_ASPECT_RATIO,
		format: videoFormat !== DEFAULT_VIDEO_FORMAT,
		language: language !== "auto",
		length: videoLength !== DEFAULT_VIDEO_LENGTH,
	});

	const {
		openPicker,
		uploading,
		uploadingCount,
		inputElement,
		dropZoneProps,
		isDraggingOver,
	} = useFileUpload({
		kind: "image",
		multiple: true,
		onUpload: addReferenceImages,
	});
	const hasText = value.trim().length > 0;
	const pasting = intent === "script";
	const activeTemplate = pasting ? undefined : template;

	const handleValueChange = (nextValue: string) => {
		onValueChange(nextValue);
		if (pasting || template) return;
		const inferred = inferBriefSettings(nextValue);

		if (!manual.current.aspectRatio) {
			const next = reconcileBriefSetting(
				aspectRatio,
				inferred.aspectRatio,
				automatic.current.aspectRatio,
			);
			automatic.current.aspectRatio = next.automatic;
			manual.current.aspectRatio = next.overridden;
			if (next.value !== aspectRatio)
				updateVideoSettings({ aspectRatio: next.value });
		}
		if (!manual.current.format) {
			const next = reconcileBriefSetting(
				videoFormat,
				inferred.format,
				automatic.current.format,
			);
			automatic.current.format = next.automatic;
			manual.current.format = next.overridden;
			if (next.value !== videoFormat)
				updateScriptSettings({ format: next.value });
		}
		if (!manual.current.language) {
			const next = reconcileBriefSetting(
				language,
				inferred.language,
				automatic.current.language,
			);
			automatic.current.language = next.automatic;
			manual.current.language = next.overridden;
			if (next.value !== language)
				updateScriptSettings({ language: next.value });
		}
		if (!manual.current.length) {
			const next = reconcileBriefSetting(
				videoLength,
				inferred.length,
				automatic.current.length,
			);
			automatic.current.length = next.automatic;
			manual.current.length = next.overridden;
			if (next.value !== videoLength)
				updateScriptSettings({ length: next.value });
		}
	};

	/** A pasted script sets its own length and format, so both go back to auto. */
	const chooseIntent = (next: ComposerIntent) => {
		setIntent(next);
		if (next === "script") {
			automatic.current.format = undefined;
			automatic.current.length = undefined;
			manual.current.format = false;
			manual.current.length = false;
			updateScriptSettings({ length: "auto", format: "auto" });
		}
	};

	const handleSubmit = () => {
		if (hasText && !busy)
			onSubmit(templateBrief(activeTemplate, value), intent);
	};

	return (
		<div
			{...dropZoneProps}
			className={cn(
				"relative w-full rounded-xl border bg-card transition-colors",
				isDraggingOver ? "border-accent" : "border-border",
			)}
		>
			<div className="px-4 py-3">
				<div className="mb-3 flex justify-center">
					<SegmentedControl
						value={intent}
						options={INTENT_OPTIONS}
						onChange={chooseIntent}
						ariaLabel="What you are giving Fylmer Assistant"
					/>
				</div>
				<AssetStrip uploadingCount={uploadingCount} />
				<div className="flex flex-col gap-1 sm:flex-row sm:items-baseline">
					{activeTemplate && (
						<TemplatePill template={activeTemplate} onRemove={clearTemplate} />
					)}
					<div className="min-w-0 flex-1 grid [&>*]:[grid-area:1/1]">
						<textarea
							rows={pasting ? 8 : 2}
							aria-label={pasting ? "Paste your script" : "Enter your prompt"}
							value={value}
							disabled={busy}
							onChange={(e) => handleValueChange(e.target.value)}
							onKeyDown={(e) => {
								if (
									e.key === "Enter" &&
									(pasting ? e.metaKey || e.ctrlKey : !e.shiftKey) &&
									!e.nativeEvent.isComposing
								) {
									e.preventDefault();
									handleSubmit();
								}
							}}
							placeholder={pasting ? SCRIPT_PLACEHOLDER : undefined}
							className="field-sizing-content max-h-[40vh] w-full resize-none overflow-y-auto rounded-sm bg-transparent font-body text-body text-foreground caret-accent outline-none placeholder:text-muted-foreground focus-visible:bg-input"
						/>
						{!hasText && !activeTemplate && !pasting && (
							<div className="pointer-events-none overflow-hidden font-body text-body">
								<AnimatedPlaceholder />
							</div>
						)}
					</div>
				</div>
				<div className="flex items-center justify-between pt-2">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						{inputElement}
						<AttachMenu openPicker={openPicker} uploading={uploading} />
						<SettingPill
							name="Aspect ratio"
							icon={<Proportions className="mr-1 h-3 w-3" />}
							value={aspectRatio}
							options={ASPECT_RATIO_OPTIONS}
							onChange={(next) => {
								manual.current.aspectRatio = true;
								automatic.current.aspectRatio = undefined;
								updateVideoSettings({ aspectRatio: next });
							}}
						/>
						<SettingPill
							name="Format"
							icon={<FilmSlate className="mr-1 h-3 w-3" />}
							value={videoFormat}
							options={VIDEO_FORMAT_OPTIONS}
							disabled={pasting}
							onChange={(next) => {
								manual.current.format = true;
								automatic.current.format = undefined;
								updateScriptSettings({ format: next });
							}}
						/>
						<SettingPill
							name="Language"
							icon={<Translate className="mr-1 h-3 w-3" />}
							value={language}
							options={LANGUAGE_OPTIONS}
							onChange={(next) => {
								manual.current.language = true;
								automatic.current.language = undefined;
								updateScriptSettings({ language: next });
							}}
						/>
						<ModelSelect
							type="llm"
							value={model}
							onChange={(llm) => updateModels({ llm })}
						>
							<SettingPillButton aria-label={`Model: ${modelLabel(model)}`}>
								<ProviderIcon
									provider={model.provider}
									size={12}
									className="mr-1"
								/>
								{model.model}
							</SettingPillButton>
						</ModelSelect>
						<SettingPill
							name="Video length"
							icon={<Hourglass className="mr-1 h-3 w-3" />}
							value={videoLength}
							options={VIDEO_LENGTH_OPTIONS}
							disabled={pasting}
							onChange={(next) => {
								manual.current.length = true;
								automatic.current.length = undefined;
								updateScriptSettings({ length: next });
							}}
						/>
						{activeTemplate && (
							<SettingPill
								name="Template"
								className="relative overflow-hidden"
								style={{ backgroundColor: activeTemplate.color }}
								value={activeTemplate.id}
								options={TEMPLATE_OPTIONS}
								onChange={applyTemplate}
							/>
						)}
					</div>
					<ActionButton
						label={busy ? "Importing script" : "Submit"}
						icon={
							busy ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<CornerDownLeft className="h-4 w-4" />
							)
						}
						onClick={handleSubmit}
						disabled={!hasText || busy}
					/>
				</div>
			</div>
			{isDraggingOver && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-card/90 font-body text-body text-accent">
					Drop images to add them as references
				</div>
			)}
		</div>
	);
}
