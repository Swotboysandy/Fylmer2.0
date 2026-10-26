import { afterEach, expect, it, vi } from "vitest";
import { accountChatProvider } from "../providers/account-chat";
const getUserById = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ auth: { admin: { getUserById } } }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("keeps the personal connection off by default", async () => {
	vi.stubEnv("FYLMER_CODEX_SUNNY_USER_ID", "");
	expect(await accountChatProvider("any")).toBeNull();
	expect(getUserById).not.toHaveBeenCalled();
});
it("does not share the connection with an unlisted user", async () => {
	vi.stubEnv("FYLMER_CODEX_SUNNY_USER_ID", "sunny-id");
	vi.stubEnv("FYLMER_CODEX_DEVELOPER_USER_ID", "developer-id");
	expect(await accountChatProvider("other-id")).toBeNull();
	expect(getUserById).not.toHaveBeenCalled();
});
it("requires the developer account to be email-confirmed", async () => {
	vi.stubEnv("FYLMER_CODEX_DEVELOPER_USER_ID", "developer-id");
	getUserById.mockResolvedValue({ data: { user: { email: "developer.cyberflux@gmail.com", email_confirmed_at: null } }, error: null });
	await expect(accountChatProvider("developer-id")).rejects.toThrow("not authorized");
});
it("rejects a different email on the developer ID", async () => {
	vi.stubEnv("FYLMER_CODEX_DEVELOPER_USER_ID", "developer-id");
	getUserById.mockResolvedValue({ data: { user: { email: "other@example.com", email_confirmed_at: "2026-10-20" } }, error: null });
	await expect(accountChatProvider("developer-id")).rejects.toThrow("not authorized");
});
it("shares the configured model with the confirmed developer account", async () => {
	vi.stubEnv("FYLMER_CODEX_DEVELOPER_USER_ID", "developer-id");
	vi.stubEnv("FYLMER_CODEX_MODEL", "gpt-5.6-luna");
	getUserById.mockResolvedValue({ data: { user: { email: "developer.cyberflux@gmail.com", email_confirmed_at: "2026-10-20" } }, error: null });
	expect((await accountChatProvider("developer-id"))?.agentModel().modelId).toBe("gpt-5.6-luna");
});
it("checks the confirmed server-side identity", async () => {
	vi.stubEnv("FYLMER_CODEX_SUNNY_USER_ID", "sunny-id");
	getUserById.mockResolvedValue({ data: { user: { email: "sunny.draftss@gmail.com", email_confirmed_at: null } }, error: null });
	await expect(accountChatProvider("sunny-id")).rejects.toThrow("not authorized");
});
it("uses the configured model only for the verified owner", async () => {
	vi.stubEnv("FYLMER_CODEX_SUNNY_USER_ID", "sunny-id");
	vi.stubEnv("FYLMER_CODEX_MODEL", "gpt-5.6-sol");
	getUserById.mockResolvedValue({ data: { user: { email: "sunny.draftss@gmail.com", email_confirmed_at: "2026-10-19" } }, error: null });
	expect((await accountChatProvider("sunny-id"))?.agentModel().modelId).toBe("gpt-5.6-sol");
});
