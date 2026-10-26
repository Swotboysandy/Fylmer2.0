import type { BundleResponse } from "./asset-bundle";
import type { VendorParams } from "@/lib/connectors/models";
import type { Priced, ProviderJobContext } from "@/lib/providers/base";
import type {
	ImageGenerateParams,
	ModelRef,
	MusicGenerateParams,
	SFXGenerateParams,
	VoicedTTSParams,
} from "@/lib/connectors/types";
import {
	jobVendorParams,
	providerForJob,
	type JobHandler,
	type JobRequest,
} from "./handlers/base";
import { videoHandler } from "./handlers/video";
import type { JobConnectorType } from "./jobs";
import { markProviderStarted } from "./jobs";
import { providerJobContext } from "./provider-job-context";
import { providerReferenceParams } from "./provider-reference-params";

function assetHandler<TReq extends ModelRef>(
	providerFor: (job: JobRequest) => Promise<{
		generate(
			params: VendorParams<TReq>,
			context?: ProviderJobContext,
		): Promise<Priced<BundleResponse>>;
	}>,
): JobHandler<TReq> {
	return {
		process: async (job) => {
			const provider = await providerFor(job);
			const params = await providerReferenceParams(job, jobVendorParams(job));
			const context = providerJobContext(job.id);
			await markProviderStarted(job.id);
			const { output, costUsd, costIsEstimate } = await provider.generate(
				params,
				context,
			);
			return {
				kind: "completed",
				result: output,
				...(costIsEstimate ? {} : { costUsd }),
			};
		},
	};
}

const HANDLERS: Record<JobConnectorType, JobHandler> = {
	image: assetHandler<ImageGenerateParams & ModelRef>((job) =>
		providerForJob("image", job),
	),
	music: assetHandler<MusicGenerateParams & ModelRef>((job) =>
		providerForJob("music", job),
	),
	sfx: assetHandler<SFXGenerateParams & ModelRef>((job) =>
		providerForJob("sfx", job),
	),
	tts: assetHandler<VoicedTTSParams & ModelRef>((job) =>
		providerForJob("tts", job),
	),
	video: videoHandler,
};

export const getJobHandler = (type: JobConnectorType): JobHandler =>
	HANDLERS[type];
