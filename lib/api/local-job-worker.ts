import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { processQueuedJob } from "./process-job";
import { loadJobForProcessing, updateJob } from "./jobs";

export function workerAuthorized(header: string | null) {
	const secret = process.env.FYLMER_JOB_WORKER_SECRET;
	if (!secret || secret.length < 32 || !header) return false;
	const expected = Buffer.from(`Bearer ${secret}`);
	const supplied = Buffer.from(header);
	return (
		supplied.length === expected.length && timingSafeEqual(expected, supplied)
	);
}

export async function processLocalDelivery() {
	if (
		process.env.FYLMER_JOB_QUEUE !== "postgres" ||
		process.env.FYLMER_STAGING_GENERATION_ENABLED !== "1"
	)
		return { paused: true };
	const client = createServiceClient();
	const { data, error } = await client.rpc("claim_asset_delivery");
	if (error) throw new Error("Could not claim a job delivery.");
	const delivery = z
		.array(z.object({ job_id: z.uuid(), lease_id: z.uuid() }))
		.parse(data)[0];
	if (!delivery) return { idle: true };
	const job = await loadJobForProcessing(delivery.job_id);
	const resumableVideo =
		job?.status === "processing" &&
		job.connector_type === "video" &&
		typeof job.metadata.providerJobId === "string" &&
		job.metadata.providerJobId.trim().length > 0;
	if (resumableVideo) {
		await updateJob(job.id, { status: "pending" });
		await processQueuedJob(delivery.job_id);
	} else if (job?.status === "processing") {
		await updateJob(job.id, {
			status: "failed",
			error:
				"The worker stopped during processing. Review the provider before retrying; the request was not submitted again.",
		});
	} else {
		await processQueuedJob(delivery.job_id);
	}
	const removed = await client
		.from("asset_deliveries")
		.delete()
		.eq("job_id", delivery.job_id)
		.eq("lease_id", delivery.lease_id);
	if (removed.error) throw new Error("Could not acknowledge job delivery.");
	return { processed: true };
}
