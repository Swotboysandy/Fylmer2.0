import { logger } from "./logger";

export function formatSSE(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

const SSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache",
	Connection: "keep-alive",
} as const;

export function createSSEStreamResponse<T>(
	chunks: AsyncIterable<T>,
	label: string,
	options: { drainOnCancel?: boolean } = {},
): Response {
	const encoder = new TextEncoder();
	let cancelled = false;
	const stream = new ReadableStream({
		async start(controller) {
			try {
				for await (const chunk of chunks) {
					if (cancelled && !options.drainOnCancel) break;
					if (!cancelled) controller.enqueue(encoder.encode(formatSSE(chunk)));
				}
				if (!cancelled) controller.close();
			} catch (error) {
				logger.error(error, `${label} stream error`);
				if (!cancelled) controller.error(error);
			}
		},
		cancel() {
			cancelled = true;
		},
	});
	return new Response(stream, { headers: SSE_HEADERS });
}

export async function* readSSE<T>(body: ReadableStream): AsyncGenerator<T> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const parts = buffer.split("\n\n");
			buffer = parts.pop() ?? "";

			for (const part of parts) {
				if (!part.startsWith("data: ")) continue;
				yield JSON.parse(part.slice(6)) as T;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
