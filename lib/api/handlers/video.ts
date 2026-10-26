import type { ModelRef, VideoGenerateParams } from "@/lib/connectors/types";
import { jobVendorParams, providerForJob, type JobHandler } from "./base";
import { TrescaVideo } from "@/lib/providers/video/tresca";
import { markProviderStarted } from "../jobs";
import { providerJobContext } from "../provider-job-context";
import { providerReferenceParams } from "../provider-reference-params";

type VideoMetadata = { providerJobId?: string };

export const videoHandler: JobHandler<
	VideoGenerateParams & ModelRef & { canvasDocument?: unknown },
	VideoMetadata
> = {
	process: async (job) => {
		const provider = await providerForJob("video", job);
		const providerJobId = job.metadata.providerJobId;
		const params = jobVendorParams(job);
		const context = providerJobContext(job.id);
		if (!providerJobId) {
			if (job.request.canvasDocument !== undefined) {
				if (!(provider instanceof TrescaVideo))
					throw new Error("Saved Canvas jobs require Tresca.");
				await markProviderStarted(job.id);
				return {
					kind: "pending",
					metadata: {
						providerJobId: await provider.submitCanvas(
							job.request.canvasDocument,
						),
					},
				};
			}
			const submissionParams = await providerReferenceParams(job, params);
			await markProviderStarted(job.id);
			return {
				kind: "pending",
				metadata: { providerJobId: await provider.submit(submissionParams) },
			};
		}

		const pollRequest =
			job.request.canvasDocument === undefined
				? params
				: { ...params, canvasDocument: job.request.canvasDocument };
		const upstream = await provider.poll(providerJobId, pollRequest, context);
		switch (upstream.kind) {
			case "ready":
				return {
					kind: "completed",
					result: upstream.asset,
					costUsd: upstream.costUsd,
				};
			case "failed":
				throw new Error("Video generation failed");
			case "pending":
				return { kind: "pending", metadata: { providerJobId } };
		}
	},
};
