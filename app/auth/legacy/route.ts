import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { legacyAuthOrigin, legacySessionUser } from "@/lib/auth/legacy-bridge";
import { createServiceClient } from "@/lib/supabase/service";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
	const origin = legacyAuthOrigin();
	if (!origin) return new Response(null, { status: 404 });
	const login = () =>
		new NextResponse(null, { status: 302, headers: { Location: "/login" } });
	const token = request.cookies.get("direkta_session")?.value;
	if (!token) return login();
	let legacyUser;
	try {
		legacyUser = await legacySessionUser(origin, token);
	} catch {
		return login();
	}
	if (!legacyUser) return login();
	const admin = createServiceClient();
	const { data: mapping, error: mappingError } = await admin
		.from("legacy_identity_map")
		.select("user_id")
		.eq("legacy_user_id", legacyUser.id)
		.maybeSingle();
	if (mappingError) throw new Error("Could not check the imported account.");
	let userId = mapping?.user_id;
	if (!userId) {
		const { data: created, error: createError } =
			await admin.auth.admin.createUser({
				email: legacyUser.email,
				password: randomBytes(32).toString("base64url"),
				app_metadata: { legacy_user_id: legacyUser.id },
			});
		if (createError || !created.user) return login();
		const { error: insertError } = await admin
			.from("legacy_identity_map")
			.insert({
				legacy_user_id: legacyUser.id,
				user_id: created.user.id,
			});
		if (insertError) return login();
		userId = created.user.id;
	}
	const { data: account, error: accountError } =
		await admin.auth.admin.getUserById(userId);
	if (
		accountError ||
		!account.user?.email ||
		account.user.app_metadata?.legacy_user_id !== legacyUser.id ||
		account.user.email.toLowerCase() !== legacyUser.email.toLowerCase()
	)
		return login();
	const { data: link, error: linkError } = await admin.auth.admin.generateLink({
		type: "magiclink",
		email: account.user.email,
	});
	if (linkError || !link.properties.hashed_token)
		throw new Error("Could not exchange the existing account session.");
	const response = new NextResponse(null, {
		status: 302,
		headers: { Location: "/" },
	});
	const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
		cookies: {
			getAll: () => request.cookies.getAll(),
			setAll: (cookies) =>
				cookies.forEach(({ name, value, options }) =>
					response.cookies.set(name, value, options),
				),
		},
	});
	const { data: verified, error: verificationError } =
		await supabase.auth.verifyOtp({
			token_hash: link.properties.hashed_token,
			type: "magiclink",
		});
	if (verificationError || verified.user?.id !== userId) return login();
	response.headers.set("Cache-Control", "no-store");
	response.headers.set("Referrer-Policy", "no-referrer");
	return response;
}
