import { beforeEach, expect, it, vi } from "vitest";
import type { JobRow } from "../jobs";

const generate = vi.fn();
vi.mock("../handlers/base", () => ({
	providerForJob: async () => ({ generate }),
	jobVendorParams: () => ({ prompt: "Synthetic speech" }),
}));
vi.mock("../handlers/video", () => ({ videoHandler: {} }));
vi.mock("../jobs", () => ({ markProviderStarted: vi.fn() }));
vi.mock("../provider-job-context", () => ({
	providerJobContext: () => ({ jobId: "fixture" }),
}));
vi.mock("../provider-reference-params", () => ({
	providerReferenceParams: async (_job: unknown, params: unknown) => params,
}));
import { getJobHandler } from "../job-handlers";

beforeEach(() => generate.mockReset());
it.each([true, false])(
	"only carries actual spend to settlement, estimated=%s",
	async (estimated) => {
		generate.mockResolvedValue({
			output: { id: "asset" },
			costUsd: 0.299,
			...(estimated ? { costIsEstimate: true } : {}),
		});
		const result = await getJobHandler("tts").process({
			id: "fixture",
			connector_type: "tts",
		} as JobRow);
		expect(result).toEqual({
			kind: "completed",
			result: { id: "asset" },
			...(estimated ? {} : { costUsd: 0.299 }),
		});
	},
);
