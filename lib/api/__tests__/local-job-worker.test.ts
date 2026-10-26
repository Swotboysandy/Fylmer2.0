import { afterEach, expect, it, vi } from "vitest";
import { workerAuthorized, processLocalDelivery } from "../local-job-worker";
import { processQueuedJob } from "../process-job";
import { loadJobForProcessing, updateJob, type JobRow } from "../jobs";
const service = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: service }));
vi.mock("../process-job", () => ({ processQueuedJob: vi.fn() }));
vi.mock("../jobs", () => ({
	loadJobForProcessing: vi.fn(),
	updateJob: vi.fn(),
}));
afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetAllMocks();
});
it("requires a long exact server-only credential", () => {
	vi.stubEnv("FYLMER_JOB_WORKER_SECRET", "a".repeat(48));
	expect(workerAuthorized(null)).toBe(false);
	expect(workerAuthorized("Bearer wrong")).toBe(false);
	expect(workerAuthorized(`Bearer ${"a".repeat(48)}`)).toBe(true);
});
it("never claims or processes a job while generation is disabled", async () => {
	vi.stubEnv("FYLMER_JOB_QUEUE", "postgres");
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "0");
	vi.stubEnv("FYLMER_TRESCA_GPU_APPROVED", "0");
	expect(await processLocalDelivery()).toEqual({ paused: true });
	expect(service).not.toHaveBeenCalled();
});
it("checks for non-GPU jobs even when Tresca is disabled", async () => {
	vi.stubEnv("FYLMER_JOB_QUEUE", "postgres");
	vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
	vi.stubEnv("FYLMER_TRESCA_GPU_APPROVED", "0");
	const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
	service.mockReturnValue({ rpc });
	expect(await processLocalDelivery()).toEqual({ idle: true });
	expect(rpc).toHaveBeenCalledWith("claim_asset_delivery");
});

it.each([
	{ connector: "video", providerJobId: "existing-upstream-job", resumes: true },
	{ connector: "video", providerJobId: undefined, resumes: false },
	{ connector: "video", providerJobId: "  ", resumes: false },
	{
		connector: "image",
		providerJobId: "existing-upstream-job",
		resumes: false,
	},
] as const)(
	"recovers $connector with saved ID=$providerJobId safely",
	async ({ connector, providerJobId, resumes }) => {
		vi.stubEnv("FYLMER_JOB_QUEUE", "postgres");
		vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
		const jobId = "8f660e99-5902-4f44-933b-42ea807fc872";
		const leaseId = "03feb7db-83b3-48af-888d-514b069a8463";
		const eq = vi.fn();
		eq.mockReturnValueOnce({ eq }).mockResolvedValueOnce({ error: null });
		service.mockReturnValue({
			rpc: vi
				.fn()
				.mockResolvedValue({
					data: [{ job_id: jobId, lease_id: leaseId }],
					error: null,
				}),
			from: vi.fn().mockReturnValue({ delete: () => ({ eq }) }),
		});
		const job: JobRow = {
			id: jobId,
			user_id: "fixture-user",
			project_id: "fixture-project",
			connector_type: connector,
			status: "processing",
			request: {},
			metadata: { providerJobId },
			result: null,
			error: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
		vi.mocked(loadJobForProcessing).mockResolvedValue(job);
		expect(await processLocalDelivery()).toEqual({ processed: true });
		if (resumes) {
			expect(updateJob).toHaveBeenCalledWith(jobId, { status: "pending" });
			expect(processQueuedJob).toHaveBeenCalledWith(jobId);
			expect(vi.mocked(updateJob).mock.invocationCallOrder[0]).toBeLessThan(
				vi.mocked(processQueuedJob).mock.invocationCallOrder[0],
			);
		} else {
			expect(updateJob).toHaveBeenCalledWith(
				jobId,
				expect.objectContaining({ status: "failed" }),
			);
			expect(processQueuedJob).not.toHaveBeenCalled();
		}
		expect(eq).toHaveBeenCalledWith("lease_id", leaseId);
	},
);
