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
		return new Response(null, { status: 403 });
	const token = request.cookies.get("direkta_session")?.value;
	if (token) {
		const old = await fetch(`${origin}/api/auth/logout`, {
			method: "POST",
			headers: { Cookie: `direkta_session=${token}` },
			cache: "no-store",
			redirect: "error",
			signal: AbortSignal.timeout(5000),
		});
		if (!old.ok) return new Response(null, { status: 502 });
	}
	const response = NextResponse.json({ ok: true });
	response.cookies.set("direkta_session", "", {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		maxAge: 0,
	});
	response.headers.set("Cache-Control", "no-store");
	return response;
}
