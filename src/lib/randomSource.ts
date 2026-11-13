/** Presentation labels shared by the app and browser-only previews. */
export function getSourceDisplayName(
	source: "quantum" | "atmospheric" | "csprng" | "mixed",
): string {
	switch (source) {
		case "quantum":
			return "ANU Quantum (양자 난수)";
		case "atmospheric":
			return "Random.org (대기 노이즈)";
		case "csprng":
			return "Web Crypto (CSPRNG)";
		case "mixed":
			return "혼합 난수 원천";
	}
}
