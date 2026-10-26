import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRow } from "../jobs";
import { getJobHandler } from "../job-handlers";

const providerForPick = vi.fn();
const markProviderStarted = vi.fn();
const generate = vi.fn();
const submit = vi.fn();
const poll = vi.fn();
vi.mock("@/lib/api/route-families", () => ({
	providerForPick: (...args: unknown[]) => providerForPick(...args),
}));
vi.mock("@/lib/api/jobs", () => ({
	markProviderStarted: (...args: unknown[]) => markProviderStarted(...args),
}));
const job: JobRow = {
	id: "job-1",
	user_id: "user-1",
	project_id: "project-1",
	connector_type: "image",
	status: "processing",
	request: {
		provider: "openslop",
		model: "Seedream 5 Lite",
		prompt: "fixture",
	},
	result: null,
	metadata: {},
	error: null,
	created_at: "2026-10-23T00:00:00Z",
	updated_at: "2026-10-23T00:00:00Z",
};

beforeEach(() => {
	vi.clearAllMocks();
	providerForPick.mockResolvedValue({ generate, submit, poll });
	markProviderStarted.mockResolvedValue(undefined);
	generate.mockResolvedValue({ output: {}, costUsd: 0.035 });
});

afterEach(() => vi.unstubAllEnvs());

describe("asset submission boundary", () => {
	it.each([null, "project-1"])(
		"does not mark or submit unresolved private references for project %s",
		async (projectId) => {
			vi.stubEnv("FYLMER_GENERATED_MEDIA_APP_ORIGIN", "");
			const referenced = {
				...job,
				project_id: projectId,
				request: {
					...job.request,
					referenceImages: [
						"https://app.example/api/generated-media/11111111-1111-4111-8111-111111111111/image",
					],
				},
			};
			await expect(getJobHandler("image").process(referenced)).rejects.toThrow(
				"before generation",
			);
			expect(markProviderStarted).not.toHaveBeenCalled();
			expect(generate).not.toHaveBeenCalled();
			expect(referenced.request.referenceImages[0]).toContain(
				"/api/generated-media/",
			);
		},
	);
	it("records submission durably before calling the provider", async () => {
		await getJobHandler("image").process(job);
		expect(markProviderStarted).toHaveBeenCalledWith(job.id);
		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: "fixture" }),
			{ jobId: job.id },
		);
		expect(markProviderStarted.mock.invocationCallOrder[0]).toBeLessThan(
			generate.mock.invocationCallOrder[0],
		);
	});
	it("never submits after a failed budget recheck", async () => {
		markProviderStarted.mockRejectedValue(new Error("Cap changed"));
		await expect(getJobHandler("image").process(job)).rejects.toThrow(
			"Cap changed",
		);
		expect(generate).not.toHaveBeenCalled();
	});
	it.each(["image", "video", "tts", "music", "sfx"] as const)(
		"does not submit %s when no provider key exists",
		async (connectorType) => {
			providerForPick.mockRejectedValue(new Error("Missing key"));
			await expect(
				getJobHandler(connectorType).process({
					...job,
					connector_type: connectorType,
				}),
			).rejects.toThrow("Missing key");
			expect(providerForPick).toHaveBeenCalledWith(
				job.user_id,
				connectorType,
				job.request,
			);
			expect(markProviderStarted).not.toHaveBeenCalled();
			expect(generate).not.toHaveBeenCalled();
			expect(submit).not.toHaveBeenCalled();
			expect(poll).not.toHaveBeenCalled();
		},
	);
});
