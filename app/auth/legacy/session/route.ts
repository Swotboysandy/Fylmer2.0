import { NextResponse, type NextRequest } from "next/server";
import { legacyAuthOrigin } from "@/lib/auth/legacy-bridge";

export async function POST(request: NextRequest) {
	const origin = legacyAuthOrigin();
	if (!origin) return new Response(null, { status: 404 });
	const requestOrigin = request.headers.get("origin");
	if (
		!requestOrigin ||
		new URL(requestOrigin).host !== request.headers.get("host")
	)
		return NextResponse.json(
			{ error: "This sign-in request came from another site." },
			{ status: 403 },
		);
	const body = await request.text();
	if (body.length > 4096) return new Response(null, { status: 413 });
	let fields: { action?: unknown };
	try {
		fields = JSON.parse(body);
	} catch {
		return new Response(null, { status: 400 });
	}
	const action = fields.action;
	if (action !== "login" && action !== "register")
		return new Response(null, { status: 400 });
	const response = await fetch(`${origin}/api/auth/${action}`, {
		method: "POST",
		body,
		headers: { "Content-Type": "application/json" },
		cache: "no-store",
		redirect: "error",
		signal: AbortSignal.timeout(10000),
	});
	const result = NextResponse.json(await response.json(), {
		status: response.status,
	});
	const cookie = response.headers.get("set-cookie");
	if (cookie) result.headers.set("set-cookie", cookie);
	result.headers.set("Cache-Control", "no-store");
	return result;
}
