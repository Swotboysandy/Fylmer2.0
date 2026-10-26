import { NextResponse } from "next/server";
import { z } from "zod";
import type { JobPoll } from "@/lib/gateway/base";
import type { ModelRef } from "@/lib/connectors/types";
import { stringifyError } from "@/lib/errors";
import {
	createJob,
	enqueueJob,
	getJob,
	updateJob,
	type JobConnectorType,
} from "./jobs";
import { failIfExpired } from "./job-deadline";
import {
	AUDIO_FIELDS,
	bodySchema,
	IMAGE_FIELDS,
	TTS_FIELDS,
	VIDEO_FIELDS,
} from "./generation-schema";
import { ownsProject } from "./projects";
import { notFound } from "./response";
import { createClient } from "@/lib/supabase/server";
import { FilmReviewSchema, generationGate } from "@/lib/fylmer/review";
import type { RouteFamily } from "./route-families";
import { compileCanvasJob } from "@/lib/fylmer/canvas-job";
import { quoteAssetCost } from "./asset-cost-quote";

type AssetBody = ModelRef & { projectId?: string } & Record<string, unknown>;

/** What each asset route takes beyond the prompt and model, and how the log names it. */
const ASSET_ROUTES: Record<
	JobConnectorType,
	{ fields: z.ZodRawShape; label: string }
> = {
	image: { fields: IMAGE_FIELDS, label: "Image generation" },
	video: { fields: VIDEO_FIELDS, label: "Video submission" },
	tts: { fields: TTS_FIELDS, label: "TTS generation" },
	music: { fields: AUDIO_FIELDS, label: "Music generation" },
	sfx: { fields: AUDIO_FIELDS, label: "SFX generation" },
};

export const createAssetRouteHandler = <TPicked extends ModelRef>(
	family: RouteFamily<TPicked>,
	type: JobConnectorType,
) => {
	const { fields, label } = ASSET_ROUTES[type];
	return family.createHandler({
		// Every route's body is this shape; the fields only add optional keys.
		schema: bodySchema(family.model(type), fields) as z.ZodType<AssetBody>,
		label,
		handle: async ({ user, input }) => {
			if (process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1") {
				return NextResponse.json(
					{
						error:
							"Media generation is not enabled for this workspace. No job was started.",
					},
					{ status: 409 },
				);
			}
			const { projectId, ...request } = input;
			if (projectId && !(await ownsProject(projectId))) return notFound();
			if (!projectId)
				return NextResponse.json(
					{ error: "Choose a project before generating media." },
					{ status: 400 },
				);
			const client = await createClient();
			const { data: review, error: reviewError } = await client.rpc(
				"film_workflow",
				{ p_project_id: projectId, p_action: "read" },
			);
			if (reviewError) throw new Error("Could not verify project approval.");
			const checkedReview = FilmReviewSchema.parse(review);
			const denied = generationGate(checkedReview, type);
			if (denied) return NextResponse.json({ error: denied }, { status: 409 });
			if (type === "video" && request.canvasVersion !== undefined) {
				if (request.model !== "Tresca H3")
					return NextResponse.json(
						{ error: "Saved Canvas jobs require Tresca H3." },
						{ status: 400 },
					);
				if (
					request.frameImage ||
					[
						request.characterAssets,
						request.referenceImages,
						request.continuityFrames,
					].some((value) => Array.isArray(value) && value.length)
				)
					return NextResponse.json(
						{
							error:
								"This Canvas template does not include uploaded references. Use the regular reference-conditioned shot workflow instead.",
						},
						{ status: 400 },
					);
				const { data: saved, error } = await client
					.from("tresca_workflows")
					.select("document, version")
					.eq("project_id", projectId)
					.maybeSingle();
				if (error) throw new Error("Could not load the saved Canvas.");
				if (!saved || saved.version !== request.canvasVersion)
					return NextResponse.json(
						{
							error:
								"The Canvas changed. Save and reload before starting this shot.",
						},
						{ status: 409 },
					);
				const compiled = compileCanvasJob(saved.document);
				request.canvasDocument = compiled.document;
				request.duration = compiled.settings.durationSeconds;
				request.width = compiled.settings.width;
				request.height = compiled.settings.height;
			}
			const costQuote =
				checkedReview.capUsd || checkedReview.mode === "autonomous"
					? await quoteAssetCost(type, request)
					: undefined;
			const { id } = await createJob({
				userId: user.id,
				projectId,
				connectorType: type,
				request,
				costQuote,
			});
			try {
				await enqueueJob(id);
			} catch (error) {
				await updateJob(id, {
					status: "failed",
					error: `Failed to queue job: ${stringifyError(error)}`,
				});
				throw error;
			}
			return NextResponse.json({ jobId: id, status: "pending" });
		},
	});
};

export const createJobPollHandler = (
	family: Pick<RouteFamily<ModelRef>, "createParamHandler">,
) =>
	family.createParamHandler({
		// A malformed id makes Postgres throw on the cast; guid() matches every
		// shape it accepts, so anything else is a 404 before the query.
		schema: z.object({ jobId: z.guid() }),
		label: "Job poll",
		handle: async ({ user, params }) => {
			const found = await getJob(params.jobId, user.id);
			if (!found) return notFound();
			const job = await failIfExpired(found);
			return NextResponse.json<JobPoll>({
				jobId: job.id,
				status: job.status,
				result: job.result,
				error: job.error,
			});
		},
	});
