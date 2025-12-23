// Re-export API functions for use in components
export {
	forceRefillPool,
	generateRandomNumbers,
	getBindingStatus,
	getPoolStatus,
	getSystemStatus,
	type RandomResult,
	type RandomSource,
} from "./randomApi";

/**
 * Get human-readable source name
 */
export function getSourceDisplayName(
	source: "quantum" | "atmospheric" | "csprng",
): string {
	switch (source) {
		case "quantum":
			return "ANU Quantum (양자 난수)";
		case "atmospheric":
			return "Random.org (대기 노이즈)";
		case "csprng":
			return "Web Crypto (CSPRNG)";
	}
}
