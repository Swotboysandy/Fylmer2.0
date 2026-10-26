import { spawn } from "node:child_process";
import { once } from "node:events";

export async function withExportLock<Result>(
	path: string,
	operation: () => Promise<Result>,
): Promise<Result> {
	const child = spawn(
		"flock",
		[
			"--exclusive",
			"--wait",
			"10",
			path,
			"sh",
			"-c",
			"printf 'locked\\n'; cat >/dev/null",
		],
		{ stdio: ["pipe", "pipe", "ignore"] },
	);
	const closed = new Promise<void>((resolve) => {
		child.once("close", () => resolve());
	});
	try {
		await Promise.race([
			once(child.stdout, "data").then(([data]) => {
				if (String(data) !== "locked\n")
					throw new Error("Unexpected export lock response.");
			}),
			once(child, "error").then(() => {
				throw new Error("Export queue locking is unavailable.");
			}),
			closed.then(() => {
				throw new Error("Export queue is busy. Please retry.");
			}),
		]);
		return await operation();
	} finally {
		child.stdin.end();
		await closed;
	}
}
