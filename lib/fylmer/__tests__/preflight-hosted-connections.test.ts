import { afterEach, expect, it, vi } from "vitest";
import {
	preflightRunConnections,
	FilmConnectionError,
} from "../preflight-run-connections";

afterEach(() => vi.unstubAllEnvs());

it("rejects every retry through the actual hosted resolver when the selected image key is missing", async () => {
	vi.stubEnv("RUNWARE_API_KEY", "");
	vi.stubEnv("FYLMER_ALLOW_MOCKS", "0");
	const network = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Unexpected provider request"));
	try {
		const project = {
			script: '<image id="opening">A keeper at the transmitter.</image>',
			store: {
				models: { image: { provider: "openslop", model: "Seedream 5 Lite" } },
			},
			generation: {},
		};
		for (let attempt = 0; attempt < 3; attempt++) {
			await expect(
				preflightRunConnections(
					project,
					"11111111-1111-4111-8111-111111111111",
				),
			).rejects.toBeInstanceOf(FilmConnectionError);
		}
		expect(network).not.toHaveBeenCalled();
	} finally {
		network.mockRestore();
	}
});
