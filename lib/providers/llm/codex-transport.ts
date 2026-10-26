import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { codexFailure } from "./codex-error";

const envelope = z.object({
	text: z.string(),
	toolCalls: z.array(z.object({ name: z.string(), arguments: z.string() })).max(4),
});

export type CodexReply = z.infer<typeof envelope>;

export function runCodexTurn(input: {
	home: string;
	model: string;
	prompt: string;
	signal?: AbortSignal;
}): Promise<CodexReply> {
	return new Promise((resolve, reject) => {
		if (input.signal?.aborted) return reject(new Error("Chat was cancelled."));
		const child = spawn("/usr/bin/codex", ["app-server"], {
			cwd: "/home/claudebot/fylmer-next-private/chat-workspace",
			env: { NODE_ENV: "production", PATH: "/usr/bin:/bin", HOME: input.home, CODEX_HOME: input.home },
			stdio: ["pipe", "pipe", "ignore"],
		});
		const lines = createInterface({ input: child.stdout });
		let done = false;
		let answer = "";
		const finish = (error?: Error, reply?: CodexReply) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", cancel);
			lines.close();
			child.kill();
			if (error) reject(error);
			else if (reply) resolve(reply);
		};
		const cancel = () => finish(new Error("Chat was cancelled."));
		const timer = setTimeout(() => finish(new Error("Codex chat timed out. Please retry.")), 120_000);
		input.signal?.addEventListener("abort", cancel, { once: true });
		const send = (message: unknown) => {
			if (!done) child.stdin.write(`${JSON.stringify(message)}\n`);
		};
		child.on("error", () => finish(new Error("The private Codex service is unavailable.")));
		child.stdin.on("error", () => finish(new Error("The private Codex connection closed.")));
		child.on("exit", () => finish(new Error("Codex exited before completing this reply.")));
		lines.on("line", (line) => {
			try {
				const message = JSON.parse(line);
				if (message.error) return finish(codexFailure(String(message.error.message)));
				if (message.method && message.id !== undefined) {
					return finish(new Error("Native Codex actions are disabled in Fylmer chat."));
				}
				if (message.id === 1) {
					send({ method: "initialized" });
					send({ id: 2, method: "thread/start", params: {
						model: input.model, ephemeral: true, cwd: "/home/claudebot/fylmer-next-private/chat-workspace",
						approvalPolicy: "never", sandbox: "read-only",
						baseInstructions: "You are Fylmer's film-planning model, not a coding agent. Never execute native tools, inspect files, browse, or run commands. Return only the requested JSON decision. Fylmer executes permitted project tools separately.",
						config: {
							"features.shell_tool": false, "features.unified_exec": false,
							"features.apps": false, "features.browser_use": false,
							"features.computer_use": false, "features.multi_agent": false,
							"features.code_mode": false, "tools.view_image": false,
							web_search: "disabled", mcp_servers: {},
						},
					} });
				}
				if (message.id === 2) {
					const threadId = z.string().parse(message.result?.thread?.id);
					send({ id: 3, method: "turn/start", params: {
						threadId, effort: "medium", input: [{ type: "text", text: input.prompt }],
						outputSchema: z.toJSONSchema(envelope),
					} });
				}
				if (message.method === "item/agentMessage/delta") {
					answer += z.string().parse(message.params?.delta);
					if (answer.length > 1_000_000) finish(new Error("Codex reply exceeded the size limit."));
				}
				if (message.method === "item/started") {
					const kind = message.params?.item?.type;
					if (!["userMessage", "agentMessage", "reasoning"].includes(kind)) {
						finish(new Error("Codex attempted an unsupported action. No project action was accepted."));
					}
				}
				if (message.method === "turn/completed") {
					if (message.params?.turn?.status !== "completed") return finish(codexFailure(String(message.params?.turn?.error?.message ?? message.params?.turn?.status)));
					finish(undefined, envelope.parse(JSON.parse(answer)));
				}
			} catch {
				finish(new Error("Codex returned an invalid chat response."));
			}
		});
		send({ id: 1, method: "initialize", params: { clientInfo: { name: "fylmer", title: "Fylmer", version: "0.1.0" } } });
	});
}
