import { serveLegacyMedia } from "@/lib/legacy/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ file: string }> };

export async function GET(request: Request, context: Context) {
	return serveLegacyMedia(request, ["oss", (await context.params).file]);
}

export async function HEAD(request: Request, context: Context) {
	return serveLegacyMedia(request, ["oss", (await context.params).file], true);
}
