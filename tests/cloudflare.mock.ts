// In-memory test binding. Actual local API keys are never loaded by tests.
export const env: {
	ANU_API_KEY?: string;
	RANDOM_ORG_API_KEY?: string;
	SEED_POOL: {
		get: (...args: unknown[]) => Promise<unknown>;
		put: (...args: unknown[]) => Promise<void>;
	};
} = {
	SEED_POOL: {
		get: async () => null,
		put: async () => {},
	},
};
