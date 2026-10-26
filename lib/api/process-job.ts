import { stringifyError } from "@/lib/errors";
import { isTerminal } from "@/lib/gateway/base";
import { failIfExpired } from "./job-deadline";
import { getJobHandler } from "./job-handlers";
import { claimJob, enqueueJob, loadJobForProcessing, updateJob } from "./jobs";
import { logger } from "./logger";
import { ProjectBudgetError } from "./project-budget-error";
import { FilmRunGateError } from "./film-run-gate-error";

const PENDING_RETRY_SECONDS = 5;

async function handleRunGate(jobId: string, error: FilmRunGateError) {
	if (error.stopped) {
		await updateJob(jobId, {
			status: "failed",
			error: error.message,
			cost_usd: 0,
		});
		return;
	}
	await updateJob(jobId, { status: "pending" });
	await enqueueJob(jobId, { delaySeconds: PENDING_RETRY_SECONDS });
}

/**
 * Drives one delivery of a queued job. Handlers whose provider is still
 * working return `pending`, and the job is redelivered to this same function
 * until it completes or outlives the deadline.
 */
export async function processQueuedJob(jobId: string): Promise<void> {
	const loaded = await loadJobForProcessing(jobId);
	if (!loaded) {
		logger.error({ jobId }, "Dropped a queue message for an unknown job");
		return;
	}
	const job = await failIfExpired(loaded);
	if (isTerminal(job.status)) return;

	try {
		if (job.status === "processing" || !(await claimJob(jobId)))
			throw new Error(`Job ${jobId} is held by another delivery`);
	} catch (error) {
		if (error instanceof FilmRunGateError) {
			await handleRunGate(jobId, error);
			return;
		}
		if (!(error instanceof ProjectBudgetError)) throw error;
		await updateJob(jobId, {
			status: "failed",
			error: error.message,
			cost_usd:
				job.provider_started_at || job.metadata.providerJobId ? undefined : 0,
		});
		return;
	}

	const handler = getJobHandler(job.connector_type);

	let outcome;
	try {
		outcome = await handler.process(job);
	} catch (error) {
		if (error instanceof FilmRunGateError) {
			await handleRunGate(jobId, error);
			return;
		}
		logger.error(error, `Job ${jobId} failed`);
		await updateJob(jobId, { status: "failed", error: stringifyError(error) });
		throw error;
	}

	if (outcome.kind === "completed") {
		await updateJob(jobId, {
			status: "completed",
			result: outcome.result,
			cost_usd: outcome.costUsd,
		});
		return;
	}

	await updateJob(jobId, { status: "pending", metadata: outcome.metadata });
	await enqueueJob(jobId, { delaySeconds: PENDING_RETRY_SECONDS });
}
