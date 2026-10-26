import {
	workerAuthorized,
	processLocalDelivery,
} from "@/lib/api/local-job-worker";

export async function POST(request: Request) {
	if (!workerAuthorized(request.headers.get("authorization")))
		return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(await processLocalDelivery());
}
