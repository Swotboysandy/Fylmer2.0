import { expect, it } from "vitest";
import { buildH3Workflow } from "../h3-workflow";
import { compileCanvasJob } from "../canvas-job";
it("binds the actual saved settings instead of silently rebuilding defaults", () => {
	const { workflow } = buildH3Workflow({
		prompt: "Maya opens the cinema",
		seed: 42,
		steps: 30,
		width: 768,
		height: 768,
	});
	const result = compileCanvasJob(workflow);
	expect(result.workflow).toEqual(workflow);
	expect(result.settings.steps).toBe(30);
	expect(result.settings.seed).toBe(42);
});
it("rejects arbitrary nodes and filesystem targets", () => {
	const { workflow } = buildH3Workflow({ prompt: "A cinema", seed: 42 });
	workflow["11"].inputs.filename_prefix = "/etc/overwrite";
	expect(() => compileCanvasJob(workflow)).toThrow("unsupported");
});
it("rejects altered model paths", () => {
	const { workflow } = buildH3Workflow({ prompt: "A cinema", seed: 42 });
	workflow["1"].inputs.unet_name = "other.safetensors";
	expect(() => compileCanvasJob(workflow)).toThrow("unsupported");
});
