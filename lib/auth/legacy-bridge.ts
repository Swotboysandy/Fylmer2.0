import { z } from "zod";

const LegacyUser = z.object({
	id: z.string().min(1).max(100),
	email: z.email(),
});

const LegacyMe = z.object({ user: LegacyUser });

export function legacyAuthOrigin(): string | null {
	if (process.env.FYLMER_LEGACY_AUTH_ENABLED !== "1") return null;
	const configured = process.env.FYLMER_LEGACY_AUTH_ORIGIN;
	if (!configured) throw new Error("The legacy auth bridge has no origin.");
	const origin = new URL(configured);
	if (
		origin.protocol !== "http:" ||
		origin.hostname !== "127.0.0.1" ||
		!origin.port ||
		origin.pathname !== "/" ||
		origin.search ||
		origin.hash ||
		origin.username ||
		origin.password
	)
		throw new Error("The legacy auth bridge must use a loopback service.");
	return origin.origin;
}

export async function legacySessionUser(origin: string, token: string) {
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
	const response = await fetch(`${origin}/api/auth/me`, {
		headers: { Cookie: `direkta_session=${token}` },
		cache: "no-store",
		redirect: "error",
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) return null;
	return LegacyMe.parse(await response.json()).user;
}
