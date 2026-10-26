import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexModel } from "../codex";
const run = vi.hoisted(() => vi.fn());
vi.mock("../codex-transport", () => ({ runCodexTurn: run }));
const model = new CodexModel("test-model", "/isolated/test");
afterEach(() => vi.resetAllMocks());
describe("account Codex model", () => {
	it("reads the project without spending a model request", async () => {
		const result = await model.doGenerate({
			prompt: [],
			toolChoice: { type: "tool", toolName: "read_script" },
			tools: [{ type: "function", name: "read_script", inputSchema: {} }],
		});
		expect(result.content[0]).toMatchObject({
			type: "tool-call",
			toolName: "read_script",
		});
		expect(run).not.toHaveBeenCalled();
	});
	it("returns a completed text decision", async () => {
		run.mockResolvedValue({
			text: "Your film is ready to review.",
			toolCalls: [],
		});
		const result = await model.doGenerate({ prompt: [] });
		expect(result.content).toEqual([
			{ type: "text", text: "Your film is ready to review." },
		]);
		expect(result.finishReason.unified).toBe("stop");
	});
	it("emits only registered project tools", async () => {
		run.mockResolvedValue({
			text: "",
			toolCalls: [{ name: "read_script", arguments: "{}" }],
		});
		const result = await model.doGenerate({
			prompt: [],
			tools: [
				{
					type: "function",
					name: "read_script",
					inputSchema: { type: "object" },
				},
			],
		});
		expect(result.content[0]).toMatchObject({
			type: "tool-call",
			toolName: "read_script",
		});
		expect(result.finishReason.unified).toBe("tool-calls");
	});
	it("rejects invented or native tools", async () => {
		run.mockResolvedValue({
			text: "",
			toolCalls: [{ name: "exec_command", arguments: "{}" }],
		});
		await expect(model.doGenerate({ prompt: [] })).rejects.toThrow(
			"unavailable",
		);
	});
	it("honors disabled tool use", async () => {
		run.mockResolvedValue({
			text: "",
			toolCalls: [{ name: "read_script", arguments: "{}" }],
		});
		await expect(
			model.doGenerate({
				prompt: [],
				toolChoice: { type: "none" },
				tools: [{ type: "function", name: "read_script", inputSchema: {} }],
			}),
		).rejects.toThrow("disabled");
	});
	it("rejects invalid tool arguments", async () => {
		run.mockResolvedValue({
			text: "",
			toolCalls: [{ name: "read_script", arguments: "null" }],
		});
		await expect(
			model.doGenerate({
				prompt: [],
				tools: [{ type: "function", name: "read_script", inputSchema: {} }],
			}),
		).rejects.toThrow("invalid tool arguments");
	});
	it("does not claim success when the transport fails", async () => {
		run.mockRejectedValue(new Error("Signed out"));
		await expect(model.doStream({ prompt: [] })).rejects.toThrow("Signed out");
	});
});
