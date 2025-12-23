export type RandomSource = "quantum" | "atmospheric" | "csprng";

export interface RandomResult {
	numbers: number[];
	source: RandomSource;
}

export interface SeedStatus {
	hasSeed: boolean;
	source: RandomSource | null;
	isLoading: boolean;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
const STORAGE_KEY = "rng_seed_data";

interface StoredSeedData {
	seed: string;
	source: RandomSource;
	counter: number;
	timestamp: number;
}

/**
 * Seeded PRNG using SHA-256 hash chain
 * Cryptographically secure when seeded with high-quality entropy
 */
class SeededPRNG {
	private seed: Uint8Array;
	private counter: number;

	constructor(seedHex: string, counter = 0) {
		this.seed = this.hexToBytes(seedHex);
		this.counter = counter;
	}

	/**
	 * Generate random bytes using SHA-256 hash chain
	 */
	async nextBytes(count: number): Promise<Uint8Array> {
		const result = new Uint8Array(count);
		let offset = 0;

		while (offset < count) {
			// Create input: seed + counter
			const input = new Uint8Array(this.seed.length + 8);
			input.set(this.seed);
			// Add counter as big-endian 64-bit integer
			const view = new DataView(input.buffer);
			view.setBigUint64(this.seed.length, BigInt(this.counter), false);

			// Hash it
			const hash = await crypto.subtle.digest("SHA-256", input);
			const hashBytes = new Uint8Array(hash);

			// Copy to result
			const toCopy = Math.min(hashBytes.length, count - offset);
			result.set(hashBytes.subarray(0, toCopy), offset);
			offset += toCopy;

			this.counter++;
		}

		return result;
	}

	/**
	 * Generate a random integer in range [min, max]
	 */
	async nextInt(min: number, max: number): Promise<number> {
		const range = max - min + 1;
		const bytes = await this.nextBytes(4);
		const value = new DataView(bytes.buffer).getUint32(0, false);
		return min + (value % range);
	}

	/**
	 * Generate multiple random integers in range [min, max]
	 */
	async nextInts(min: number, max: number, count: number): Promise<number[]> {
		const range = max - min + 1;
		const bytes = await this.nextBytes(count * 4);
		const view = new DataView(bytes.buffer);
		const result: number[] = [];

		for (let i = 0; i < count; i++) {
			const value = view.getUint32(i * 4, false);
			result.push(min + (value % range));
		}

		return result;
	}

	getCounter(): number {
		return this.counter;
	}

	private hexToBytes(hex: string): Uint8Array {
		const bytes = new Uint8Array(hex.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
		}
		return bytes;
	}
}

/**
 * Random Service Manager
 * Manages seed fetching and PRNG lifecycle
 */
class RandomServiceManager {
	private prng: SeededPRNG | null = null;
	private source: RandomSource | null = null;
	private seedHex: string | null = null;
	private isInitializing = false;
	private initPromise: Promise<void> | null = null;
	private onStatusChange?: (status: SeedStatus) => void;

	constructor() {
		this.loadFromStorage();
	}

	/**
	 * Set callback for status changes
	 */
	setStatusChangeCallback(callback: (status: SeedStatus) => void) {
		this.onStatusChange = callback;
	}

	/**
	 * Get current status
	 */
	getStatus(): SeedStatus {
		return {
			hasSeed: this.prng !== null,
			source: this.source,
			isLoading: this.isInitializing,
		};
	}

	/**
	 * Initialize PRNG with seed from server
	 */
	async initialize(): Promise<void> {
		if (this.prng) {
			return; // Already initialized
		}

		if (this.initPromise) {
			return this.initPromise; // Already initializing
		}

		this.isInitializing = true;
		this.notifyStatusChange();

		this.initPromise = this.fetchAndInitialize();

		try {
			await this.initPromise;
		} finally {
			this.isInitializing = false;
			this.initPromise = null;
			this.notifyStatusChange();
		}
	}

	/**
	 * Generate random numbers
	 */
	async generateNumbers(
		min: number,
		max: number,
		count: number,
	): Promise<RandomResult> {
		// Ensure initialized
		await this.initialize();

		if (!this.prng) {
			// Fallback to CSPRNG if initialization failed
			return {
				numbers: this.generateCSPRNG(min, max, count),
				source: "csprng",
			};
		}

		const numbers = await this.prng.nextInts(min, max, count);

		// Save counter to storage
		this.saveToStorage();

		return {
			numbers,
			source: this.source || "csprng",
		};
	}

	/**
	 * Generate unique random numbers (no duplicates)
	 */
	async generateUniqueNumbers(
		min: number,
		max: number,
		count: number,
	): Promise<RandomResult> {
		await this.initialize();

		if (!this.prng) {
			return {
				numbers: this.generateUniqueCSPRNG(min, max, count),
				source: "csprng",
			};
		}

		const set = new Set<number>();
		const range = max - min + 1;

		if (count > range) {
			throw new Error("Cannot generate more unique numbers than range allows");
		}

		while (set.size < count) {
			const num = await this.prng.nextInt(min, max);
			set.add(num);
		}

		this.saveToStorage();

		return {
			numbers: Array.from(set),
			source: this.source || "csprng",
		};
	}

	/**
	 * Force re-fetch seed from server
	 */
	async refreshSeed(): Promise<void> {
		this.prng = null;
		this.source = null;
		this.seedHex = null;
		localStorage.removeItem(STORAGE_KEY);
		await this.initialize();
	}

	/**
	 * Fetch seed from server and initialize PRNG
	 */
	private async fetchAndInitialize(): Promise<void> {
		try {
			const response = await fetch(`${API_BASE_URL}/seed`, {
				signal: AbortSignal.timeout(10000),
			});

			if (!response.ok) {
				throw new Error(`API returned ${response.status}`);
			}

			const data = (await response.json()) as {
				success: boolean;
				data?: { seed: string; source: string };
			};

			if (!data.success || !data.data?.seed) {
				throw new Error("Invalid API response");
			}

			this.seedHex = data.data.seed;
			this.source = data.data.source as RandomSource;
			this.prng = new SeededPRNG(this.seedHex);

			this.saveToStorage();
			console.log(`PRNG initialized with ${this.source} seed`);
		} catch (error) {
			console.warn("Failed to fetch seed from server:", error);

			// Fallback: generate local seed using CSPRNG
			const localSeed = this.generateLocalSeed();
			this.seedHex = localSeed;
			this.source = "csprng";
			this.prng = new SeededPRNG(localSeed);

			this.saveToStorage();
			console.log("PRNG initialized with local CSPRNG seed (fallback)");
		}
	}

	/**
	 * Generate local seed using CSPRNG
	 */
	private generateLocalSeed(): string {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	/**
	 * Generate CSPRNG fallback numbers
	 */
	private generateCSPRNG(min: number, max: number, count: number): number[] {
		const range = max - min + 1;
		const values = new Uint32Array(count);
		crypto.getRandomValues(values);
		return Array.from(values).map((v) => min + (v % range));
	}

	/**
	 * Generate unique CSPRNG fallback numbers
	 */
	private generateUniqueCSPRNG(
		min: number,
		max: number,
		count: number,
	): number[] {
		const range = max - min + 1;
		const set = new Set<number>();

		while (set.size < count) {
			const values = new Uint32Array(1);
			crypto.getRandomValues(values);
			set.add(min + (values[0] % range));
		}

		return Array.from(set);
	}

	/**
	 * Load seed from localStorage
	 */
	private loadFromStorage(): void {
		try {
			const data = localStorage.getItem(STORAGE_KEY);
			if (!data) return;

			const stored: StoredSeedData = JSON.parse(data);

			// Check if seed is less than 24 hours old
			const oneDayMs = 24 * 60 * 60 * 1000;
			if (Date.now() - stored.timestamp > oneDayMs) {
				localStorage.removeItem(STORAGE_KEY);
				return;
			}

			this.seedHex = stored.seed;
			this.source = stored.source;
			this.prng = new SeededPRNG(stored.seed, stored.counter);

			console.log(
				`Restored PRNG from storage (source: ${stored.source}, counter: ${stored.counter})`,
			);
		} catch (e) {
			console.warn("Failed to load seed from storage:", e);
		}
	}

	/**
	 * Save seed to localStorage
	 */
	private saveToStorage(): void {
		if (!this.seedHex || !this.source || !this.prng) return;

		try {
			const data: StoredSeedData = {
				seed: this.seedHex,
				source: this.source,
				counter: this.prng.getCounter(),
				timestamp: Date.now(),
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch (e) {
			console.warn("Failed to save seed to storage:", e);
		}
	}

	/**
	 * Notify status change callback
	 */
	private notifyStatusChange(): void {
		if (this.onStatusChange) {
			this.onStatusChange(this.getStatus());
		}
	}
}

// Singleton instance
export const randomService = new RandomServiceManager();

/**
 * Generate random numbers with tiered source
 */
export async function generateRandomNumbers(
	min: number,
	max: number,
	count: number,
	options?: {
		unique?: boolean;
	},
): Promise<RandomResult> {
	if (options?.unique) {
		return randomService.generateUniqueNumbers(min, max, count);
	}
	return randomService.generateNumbers(min, max, count);
}

/**
 * Initialize the random service (call on app start)
 */
export async function initializeRandomService(): Promise<void> {
	await randomService.initialize();
}

/**
 * Get human-readable source name
 */
export function getSourceDisplayName(source: RandomSource): string {
	switch (source) {
		case "quantum":
			return "ANU Quantum (양자 난수 시드)";
		case "atmospheric":
			return "Random.org (대기 노이즈 시드)";
		case "csprng":
			return "Web Crypto (로컬 시드)";
	}
}

/**
 * Get source description
 */
export function getSourceDescription(source: RandomSource): string {
	switch (source) {
		case "quantum":
			return "호주 국립대학교의 양자 진공 요동 기반 시드로 초기화된 PRNG";
		case "atmospheric":
			return "대기 중 라디오 노이즈 기반 시드로 초기화된 PRNG";
		case "csprng":
			return "운영체제 엔트로피 풀 기반 시드로 초기화된 PRNG";
	}
}
