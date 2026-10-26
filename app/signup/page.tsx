import LegacyAuthForm from "../components/legacy-auth-form";
import SignupForm from "./signup-form";

export default function SignupPage() {
	if (process.env.FYLMER_LEGACY_AUTH_ENABLED === "1")
		return <LegacyAuthForm action="register" />;
	return <SignupForm />;
}
