import { afterEach, describe, expect, it, vi } from "vitest";
import { TrescaVideo } from "../tresca";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("Tresca staging safety", () => {
	it("uploads inline image bytes without fetching a private application URL", async () => {
		vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
		vi.stubEnv("FYLMER_TRESCA_GPU_APPROVED", "1");
		vi.stubEnv("FYLMER_TRESCA_HOURLY_USD", "1");
		vi.stubEnv("FYLMER_TRESCA_STAGING_URL", "https://worker.example.invalid");
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ name: "owned-frame.png" }))
			.mockResolvedValueOnce(Response.json({ prompt_id: "synthetic-job" }));
		vi.stubGlobal("fetch", fetcher);
		const encoded =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=";
		expect(
			await new TrescaVideo().submit({
				model: "minimax-h3",
				prompt: "Synthetic adapter test",
				frameImage: `data:image/png;base64,${encoded}`,
			}),
		).toBe("synthetic-job");
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher.mock.calls[0][0]).toBe(
			"https://worker.example.invalid/upload/image",
		);
		const uploaded = fetcher.mock.calls[0][1].body.get("image") as Blob;
		expect(Buffer.from(await uploaded.arrayBuffer())).toEqual(
			Buffer.from(encoded, "base64"),
		);
		expect(fetcher.mock.calls[1][0]).toBe(
			"https://worker.example.invalid/prompt",
		);
	});
	it("never contacts a worker while GPU generation is disabled", async () => {
		vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "0");
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await expect(
			new TrescaVideo().submit({
				model: "minimax-h3",
				prompt: "A rainy platform",
			}),
		).rejects.toThrow("disabled");
		expect(fetch).not.toHaveBeenCalled();
	});
	it("requires separate GPU approval even if generation is enabled", async () => {
		vi.stubEnv("FYLMER_STAGING_GENERATION_ENABLED", "1");
		vi.stubEnv("FYLMER_TRESCA_GPU_APPROVED", "0");
		await expect(
			new TrescaVideo().submit({
				model: "minimax-h3",
				prompt: "A rainy platform",
			}),
		).rejects.toThrow("disabled");
	});
	it("reports a missing isolated worker rather than pretending to connect", async () => {
		vi.stubEnv("FYLMER_TRESCA_STAGING_URL", "");
		expect((await new TrescaVideo().validate()).ok).toBe(false);
	});
});
