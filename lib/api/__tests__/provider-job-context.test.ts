import { afterEach, expect, it, vi } from "vitest";
import { providerJobContext } from "../provider-job-context";

afterEach(() => vi.unstubAllEnvs());
it("retains legacy storage when private storage is not selected", () => {
	vi.stubEnv("NEXT_PUBLIC_STORAGE_PROVIDER", "vercel");
	expect(providerJobContext("job-fixture")).toEqual({ jobId: "job-fixture" });
});
it("refuses unconfigured private media origins before creating a provider context", () => {
	vi.stubEnv("NEXT_PUBLIC_STORAGE_PROVIDER", "supabase");
	vi.stubEnv("FYLMER_GENERATED_MEDIA_ORIGINS", "");
	expect(() => providerJobContext("job-fixture")).toThrow("before starting");
});
it.each([
	"https://secret@provider.example",
	"https://provider.example/path",
	"file:///private",
])("rejects invalid configured origin %s", (origin) => {
	vi.stubEnv("NEXT_PUBLIC_STORAGE_PROVIDER", "supabase");
	vi.stubEnv("FYLMER_GENERATED_MEDIA_ORIGINS", origin);
	expect(() => providerJobContext("job-fixture")).toThrow("exact provider");
});
