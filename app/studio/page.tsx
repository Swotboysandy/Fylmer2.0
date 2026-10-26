import { redirect } from "next/navigation";

export default function LegacyStudioRedirect() {
	redirect("/auth/legacy");
}
