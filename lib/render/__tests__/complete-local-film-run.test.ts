import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeLocalFilmRun } from "../complete-local-film-run";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
	createServiceClient: () => ({ rpc }),
}));
const directories: string[] = [];
const userId = "11111111-1111-4111-8111-111111111111";
const renderId = "22222222-2222-4222-8222-222222222222";
const source = {
	projectId: "33333333-3333-4333-8333-333333333333",
	runId: "44444444-4444-4444-8444-444444444444",
	approvalHash: "a".repeat(32),
};
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "fylmer-completion-"));
	directories.push(directory);
	await writeFile(join(directory, "manifest.json"), JSON.stringify({ source }));
	await writeFile(join(directory, "done.json"), JSON.stringify({ size: 4 }));
	await writeFile(join(directory, "output.mp4"), "test");
	return directory;
}
afterEach(async () => {
	rpc.mockReset();
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});
it.each([true, false])(
	"returns the database completion decision without inventing success: %s",
	async (accepted) => {
		const directory = await fixture();
		rpc.mockResolvedValue({ data: accepted, error: null });
		expect(await completeLocalFilmRun(directory, userId, renderId)).toBe(
			accepted,
		);
		expect(rpc).toHaveBeenCalledWith("complete_film_run_export", {
			p_run_id: source.runId,
			p_user_id: userId,
			p_project_id: source.projectId,
			p_render_id: renderId,
			p_approval_hash: source.approvalHash,
		});
	},
);
it.each(["failed.json", "cancelled.json", "pending"])(
	"never completes unsuccessful output: %s",
	async (state) => {
		const directory = await fixture();
		if (state === "pending") await rm(join(directory, "done.json"));
		else await writeFile(join(directory, state), "{}");
		expect(await completeLocalFilmRun(directory, userId, renderId)).toBe(false);
		expect(rpc).not.toHaveBeenCalled();
	},
);
it("leaves legacy exports unassociated", async () => {
	const directory = await fixture();
	await writeFile(
		join(directory, "manifest.json"),
		JSON.stringify({
			source: {
				projectId: source.projectId,
				approvalHash: source.approvalHash,
			},
		}),
	);
	expect(await completeLocalFilmRun(directory, userId, renderId)).toBe(false);
	expect(rpc).not.toHaveBeenCalled();
});
it("refuses missing or truncated output before database completion", async () => {
	const directory = await fixture();
	await writeFile(join(directory, "output.mp4"), "x");
	await expect(
		completeLocalFilmRun(directory, userId, renderId),
	).rejects.toThrow("does not match");
	await rm(join(directory, "output.mp4"));
	await expect(
		completeLocalFilmRun(directory, userId, renderId),
	).rejects.toThrow();
	expect(rpc).not.toHaveBeenCalled();
});
it("surfaces database failure so a later observation can retry", async () => {
	const directory = await fixture();
	rpc
		.mockResolvedValueOnce({ error: { message: "unavailable" } })
		.mockResolvedValueOnce({ data: true, error: null });
	await expect(
		completeLocalFilmRun(directory, userId, renderId),
	).rejects.toThrow("retry checking");
	expect(await completeLocalFilmRun(directory, userId, renderId)).toBe(true);
});
