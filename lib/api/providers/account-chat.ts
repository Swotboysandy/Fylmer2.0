import { createServiceClient } from "@/lib/supabase/service";
import { CodexLLM } from "@/lib/providers/llm/codex";

export async function accountChatProvider(userId: string) {
	const account = [
		{
			id: process.env.FYLMER_CODEX_SUNNY_USER_ID,
			email: "sunny.draftss@gmail.com",
		},
		{
			id: process.env.FYLMER_CODEX_DEVELOPER_USER_ID,
			email: "developer.cyberflux@gmail.com",
		},
	].find(({ id }) => id && id === userId);
	if (!account) return null;
	const { data, error } = await createServiceClient().auth.admin.getUserById(userId);
	if (error || !data.user?.email_confirmed_at || data.user.email?.toLowerCase() !== account.email) {
		throw new Error("This account is not authorized for the private Codex connection.");
	}
	const model = process.env.FYLMER_CODEX_MODEL;
	if (!model) throw new Error("The private Codex model has not been selected.");
	return new CodexLLM("/home/claudebot/fylmer-next-private/codex/sunny", model);
}
