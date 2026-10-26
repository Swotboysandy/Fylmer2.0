import { beforeEach, expect, it, vi } from "vitest";
const resolveProvider = vi.fn();
vi.mock("@/lib/api/route-families", () => ({
	providerForPick: (...args: unknown[]) => resolveProvider(...args),
}));
import { preflightRunConnections } from "../preflight-run-connections";
const userId = "11111111-1111-4111-8111-111111111111";
const project = () => ({
	script:
		'<image id="one">A keeper.</image><image id="two">A lighthouse.</image>',
	store: {},
	generation: {},
});
beforeEach(() => {
	resolveProvider.mockReset();
	resolveProvider.mockResolvedValue({});
});
it("resolves duplicate selected models only once without validating or generating", async () => {
	const generate = vi.fn();
	const validate = vi.fn();
	resolveProvider.mockResolvedValue({ generate, validate });
	await preflightRunConnections(project(), userId);
	expect(resolveProvider).toHaveBeenCalledTimes(1);
	expect(generate).not.toHaveBeenCalled();
	expect(validate).not.toHaveBeenCalled();
});
it("resolves BYOK using the actual owner and selected model", async () => {
	await preflightRunConnections(
		{
			...project(),
			store: {
				models: { image: { provider: "runware", model: "Seedream 5 Lite" } },
			},
		},
		userId,
	);
	expect(resolveProvider).toHaveBeenCalledWith(userId, "image", {
		provider: "runware",
		model: "Seedream 5 Lite",
	});
});
it("does not require a provider for existing pinned media", async () => {
	const selected = {
		status: "idle",
		startedAt: null,
		error: null,
		resultInputs: null,
		connectorType: "image",
		pinned: true,
		result: { imageUrl: "https://example.invalid/still.png", durationSec: 0 },
	};
	await preflightRunConnections(
		{ ...project(), generation: { one: selected, two: selected } },
		userId,
	);
	expect(resolveProvider).not.toHaveBeenCalled();
});
it("fails safely without leaking a provider secret", async () => {
	resolveProvider.mockRejectedValue(new Error("secret-key"));
	await expect(preflightRunConnections(project(), userId)).rejects.toThrow(
		"connection is unavailable",
	);
});

it("reports every missing model connection once without sending provider requests", async () => {
	resolveProvider.mockRejectedValue(new Error("secret-key"));
	const mixed = {
		...project(),
		script:
			'<image id="one">A keeper.</image><image id="two">A lighthouse.</image><video id="three">Waves move.</video>',
		store: {
			models: {
				image: { provider: "runware", model: "Seedream 5 Lite" },
				video: { provider: "runware", model: "Kling 3 Turbo" },
			},
		},
	};
	const error = await preflightRunConnections(mixed, userId).catch(
		(error: Error) => error,
	);
	expect(error).toBeInstanceOf(Error);
	expect(String(error)).toContain("Seedream 5 Lite (image)");
	expect(String(error)).toContain("Kling 3 Turbo (video)");
	expect(String(error)).toContain("No film run was started");
	expect(String(error)).not.toContain("secret-key");
	expect(resolveProvider).toHaveBeenCalledTimes(2);
});
