import { afterEach, expect, it, vi } from "vitest";
import { providerFileBytes } from "../private-provider-storage";

const file = { key: "image", filename: "image.png", contentType: "image/png" };
afterEach(() => vi.unstubAllGlobals());
it("handles provider bytes, array buffers and metadata strings", async () => {
	for (const data of [
		Buffer.from("data"),
		new TextEncoder().encode("data").buffer,
		"data",
	])
		expect(await providerFileBytes({ ...file, data }, [], 10)).toEqual(
			Buffer.from("data"),
		);
});
it("downloads only exact approved origins with redirects disabled", async () => {
	const fetcher = vi.fn().mockResolvedValue(new Response("image"));
	vi.stubGlobal("fetch", fetcher);
	expect(
		await providerFileBytes(
			{ ...file, url: "https://provider.example/result?signature=fixture" },
			["https://provider.example"],
			10,
		),
	).toEqual(Buffer.from("image"));
	expect(fetcher).toHaveBeenCalledWith(
		expect.any(URL),
		expect.objectContaining({
			redirect: "error",
			signal: expect.any(AbortSignal),
		}),
	);
});
it.each([
	"http://127.0.0.1/private",
	"https://provider.example.evil/result",
	"https://secret@provider.example/result",
	"file:///tmp/private",
	"https://provider.example/result#fragment",
])("rejects unapproved or unsafe remote URL %s", async (url) => {
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	await expect(
		providerFileBytes({ ...file, url }, ["https://provider.example"], 10),
	).rejects.toThrow();
	expect(fetcher).not.toHaveBeenCalled();
});
it.each([
	new Response("too large", { headers: { "content-length": "100" } }),
	new Response("too large"),
	new Response(""),
])("rejects oversized and empty streamed responses", async (response) => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
	await expect(
		providerFileBytes(
			{ ...file, url: "https://provider.example/result" },
			["https://provider.example"],
			3,
		),
	).rejects.toThrow();
});
it("rejects oversized inline media before storage", async () => {
	await expect(
		providerFileBytes({ ...file, data: "too large" }, [], 2),
	).rejects.toThrow("size limit");
});
