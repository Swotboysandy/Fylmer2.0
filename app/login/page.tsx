import AuthForm from "../components/auth-form";
import LegacyAuthForm from "../components/legacy-auth-form";

export default function LoginPage() {
	if (process.env.FYLMER_LEGACY_AUTH_ENABLED === "1")
		return <LegacyAuthForm action="login" />;
	return (
		<AuthForm
			heading="Login"
			subtitle="Welcome back to Fylmer"
			submitLabel="Send login link"
			shouldCreateUser={false}
		/>
	);
}
