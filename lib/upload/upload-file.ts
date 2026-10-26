import { upload } from "@vercel/blob/client";
import { uploadPathname, type UploadKind } from "./upload-files";
import { createClient } from "@/lib/supabase/client";

export async function uploadFile(
	kind: UploadKind,
	file: File,
): Promise<string> {
	if (process.env.NEXT_PUBLIC_STORAGE_PROVIDER === "supabase") {
		const client = createClient();
		const { data: { user } } = await client.auth.getUser();
		if (!user) throw new Error("Sign in before uploading media.");
		if (!file.type.startsWith(`${kind}/`) || file.size > 100 * 1024 * 1024) throw new Error("Choose a matching media file smaller than 100 MB.");
		const pathname = `${user.id}/${crypto.randomUUID()}/${uploadPathname(file.name)}`;
		const bucket = client.storage.from("fylmer-media");
		const { error } = await bucket.upload(pathname, file, { contentType: file.type, upsert: false });
		if (error) throw error;
		const { data, error: signError } = await bucket.createSignedUrl(pathname, 604800);
		if (signError) throw signError;
		return data.signedUrl;
	}
	const { url } = await upload(uploadPathname(file.name), file, {
		access: "public",
		handleUploadUrl: `/api/upload/${kind}`,
		contentType: file.type,
	});
	return url;
}
