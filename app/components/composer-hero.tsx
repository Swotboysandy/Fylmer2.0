"use client";

import { useRef, useState } from "react";
import { useSlateStatic } from "slate-react";
import { Button } from "@/components/ui/button";
import { createProjectLLM } from "@/lib/connectors/project-llm";
import { useProjectId } from "@/lib/project/project-provider";
import { errorMessage } from "@/lib/errors";
import { useProjectStoreHandle } from "@/lib/project/project-store-provider";
import { useOpenWorkspace } from "@/lib/script/script-provider";
import { streamScript } from "@/lib/script/stream-script";
import { useTemplate } from "@/lib/templates/use-template";
import { useSloppy } from "./sloppy/sloppy-provider";
import BackToMySlopLink from "./back-to-my-slop-link";
import ComposerCopilot, {
	type ComposerIntent,
} from "./copilot/composer-copilot";
import TemplateGallery from "./template-gallery";

export default function ComposerHero() {
	const openWorkspace = useOpenWorkspace();
	const { applyTemplate } = useTemplate();
	const { send } = useSloppy();
	const [value, setValue] = useState("");
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState("");
	const importingRef = useRef(false);
	const editor = useSlateStatic();
	const store = useProjectStoreHandle();
	const projectId = useProjectId();

	const start = async (brief: string, intent: ComposerIntent) => {
		if (importingRef.current) return;
		if (intent === "story") {
			openWorkspace();
			send(brief);
			setValue("");
			return;
		}
		importingRef.current = true;
		setImporting(true);
		setError("");
		try {
			await streamScript(
				editor,
				store.getState().scriptSettings,
				createProjectLLM(editor.defaultModels().llm, projectId),
				{ kind: "adapt", script: brief },
			);
			setValue("");
			openWorkspace();
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			importingRef.current = false;
			setImporting(false);
		}
	};

	return (
		<div className="flex w-full max-w-2xl flex-col items-center px-4">
			<BackToMySlopLink className="mb-4 self-start" />
			<h1 className="mb-6 text-center font-serif text-[clamp(48px,12vw,85px)] leading-[0.95em] tracking-[-0.04em] text-balance text-foreground">
				Describe your film
			</h1>

			<ComposerCopilot
				value={value}
				onValueChange={setValue}
				busy={importing}
				onSubmit={(brief, intent) => void start(brief, intent)}
			/>
			{error && (
				<p role="alert" className="mt-3 text-label text-destructive">
					{error}
				</p>
			)}

			<Button
				variant="ghost"
				size="sm"
				className="mt-3 text-muted-foreground"
				onClick={openWorkspace}
			>
				Skip to a blank canvas
			</Button>

			<TemplateGallery
				onSelect={(templateId, examplePrompt) => {
					applyTemplate(templateId);
					setValue(examplePrompt);
				}}
			/>
		</div>
	);
}
