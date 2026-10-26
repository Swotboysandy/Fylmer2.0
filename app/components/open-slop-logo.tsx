import Image from "next/image";

export default function OpenSlopLogo({
	className = "w-14 h-auto",
	wordmark = false,
}: {
	className?: string;
	wordmark?: boolean;
}) {
	if (wordmark)
		return (
			<span className={className}>
				<Image
					src="/brand/fylmer-logo-light.png"
					alt="Fylmer"
					width={480}
					height={146}
					className="h-full w-full object-contain dark:hidden"
					unoptimized
				/>
				<Image
					src="/brand/fylmer-logo-dark.png"
					alt="Fylmer"
					width={480}
					height={172}
					className="hidden h-full w-full object-contain dark:block"
					unoptimized
				/>
			</span>
		);
	return (
		<Image
			src="/brand/fylmer-mark.png"
			alt="Fylmer logo"
			width={256}
			height={256}
			className={className}
			unoptimized
		/>
	);
}
