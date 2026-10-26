import { afterEach, expect, it, vi } from "vitest";
import { createSSEStreamResponse } from "../sse";
import { logger } from "../logger";

afterEach(() => vi.restoreAllMocks());

it("drains an admitted text request to its final ledger write after disconnect", async () => {
	const release = Promise.withResolvers<void>();
	const recorded = vi.fn();
	const closed = vi.fn();
	async function* chunks() {
		try {
			yield { text: "start" };
			await release.promise;
			yield { text: "finish" };
			recorded(0.42);
		} finally {
			closed();
		}
	}
	const response = createSSEStreamResponse(chunks(), "LLM", {
		drainOnCancel: true,
	});
	const reader = response.body?.getReader();
	await reader?.read();
	await reader?.cancel();
	expect(recorded).not.toHaveBeenCalled();
	release.resolve();
	await vi.waitFor(() =>
		expect(recorded).toHaveBeenCalledExactlyOnceWith(0.42),
	);
	expect(closed).toHaveBeenCalledTimes(1);
});

it("does not opt unrelated streams into background completion", async () => {
	const release = Promise.withResolvers<void>();
	const recorded = vi.fn();
	const closed = vi.fn();
	async function* chunks() {
		try {
			yield "start";
			await release.promise;
			yield "finish";
			recorded();
		} finally {
			closed();
		}
	}
	const response = createSSEStreamResponse(chunks(), "Other");
	const reader = response.body?.getReader();
	await reader?.read();
	await reader?.cancel();
	release.resolve();
	await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
	expect(recorded).not.toHaveBeenCalled();
});

it("logs a provider failure after disconnect without inventing successful accounting", async () => {
	const log = vi.spyOn(logger, "error").mockImplementation(() => {});
	const release = Promise.withResolvers<void>();
	const recorded = vi.fn();
	const error = new Error("Provider failed");
	async function* provider() {
		yield "start";
		await release.promise;
		throw error;
	}
	async function* chunks() {
		yield* provider();
		recorded();
	}
	const response = createSSEStreamResponse(chunks(), "LLM", {
		drainOnCancel: true,
	});
	const reader = response.body?.getReader();
	await reader?.read();
	await reader?.cancel();
	release.resolve();
	await vi.waitFor(() =>
		expect(log).toHaveBeenCalledWith(error, "LLM stream error"),
	);
	expect(recorded).not.toHaveBeenCalled();
});

it("continues to deliver failures to a connected reader", async () => {
	vi.spyOn(logger, "error").mockImplementation(() => {});
	async function* chunks() {
		yield "start";
		throw new Error("Provider failed");
	}
	const response = createSSEStreamResponse(chunks(), "LLM", {
		drainOnCancel: true,
	});
	await expect(response.text()).rejects.toThrow("Provider failed");
});
