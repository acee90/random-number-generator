export type RandomSource = "quantum" | "atmospheric" | "csprng";

export interface RandomResult {
	numbers: number[];
	source: RandomSource;
}

/**
 * Priority 1: ANU Quantum Random Number Generator
 */
async function fetchQuantumNumbers(
	min: number,
	max: number,
	count: number,
): Promise<number[] | null> {
	try {
		const response = await fetch(
			`https://qrng.anu.edu.au/API/jsonI.php?length=${count}&type=uint16&size=2`,
			{ signal: AbortSignal.timeout(5000) },
		);

		if (!response.ok) {
			throw new Error(`ANU API returned ${response.status}`);
		}

		const data = (await response.json()) as {
			success: boolean;
			data?: number[];
		};

		if (!data.success || !data.data || data.data.length === 0) {
			throw new Error("Invalid ANU API response");
		}

		// Map to range [min, max]
		const range = max - min + 1;
		const numbers = data.data.map((v) => min + (v % range));
		console.log("Generated numbers from ANU Quantum");
		return numbers;
	} catch (error) {
		console.warn("Failed to fetch from ANU Quantum:", error);
		return null;
	}
}

/**
 * Priority 2: Random.org Atmospheric Noise
 */
async function fetchAtmosphericNumbers(
	min: number,
	max: number,
	count: number,
): Promise<number[] | null> {
	try {
		const response = await fetch(
			`https://www.random.org/integers/?num=${count}&min=${min}&max=${max}&col=1&base=10&format=plain&rnd=new`,
			{ signal: AbortSignal.timeout(5000) },
		);

		if (!response.ok) {
			throw new Error(`Random.org API returned ${response.status}`);
		}

		const text = await response.text();
		const numbers = text
			.trim()
			.split("\n")
			.map((v) => Number.parseInt(v.trim(), 10));

		if (numbers.length < count || numbers.some(Number.isNaN)) {
			throw new Error("Invalid Random.org response");
		}

		console.log("Generated numbers from Random.org");
		return numbers;
	} catch (error) {
		console.warn("Failed to fetch from Random.org:", error);
		return null;
	}
}

/**
 * Priority 3: Web Crypto API (CSPRNG)
 */
function generateCSPRNGNumbers(min: number, max: number, count: number): number[] {
	const range = max - min + 1;
	const values = new Uint32Array(count);
	crypto.getRandomValues(values);
	const numbers = Array.from(values).map((v) => min + (v % range));
	console.log("Generated numbers from CSPRNG");
	return numbers;
}

/**
 * Generate unique numbers from array, re-fetching if needed
 */
function makeUnique(numbers: number[], min: number, max: number): number[] {
	const set = new Set<number>();
	const range = max - min + 1;

	for (const n of numbers) {
		set.add(n);
	}

	// Fill remaining with CSPRNG if needed
	while (set.size < numbers.length && set.size < range) {
		const values = new Uint32Array(1);
		crypto.getRandomValues(values);
		set.add(min + (values[0] % range));
	}

	return Array.from(set).slice(0, numbers.length);
}

/**
 * Generate random numbers with priority fallback
 * Priority 1: ANU Quantum RNG
 * Priority 2: Random.org Atmospheric Noise
 * Priority 3: Web Crypto API (CSPRNG)
 */
export async function generateRandomNumbers(
	min: number,
	max: number,
	count: number,
	options?: { unique?: boolean },
): Promise<RandomResult> {
	let numbers: number[] | null = null;
	let source: RandomSource = "csprng";

	// Priority 1: Try ANU Quantum RNG
	numbers = await fetchQuantumNumbers(min, max, count);
	if (numbers) {
		source = "quantum";
	}

	// Priority 2: Try Random.org
	if (!numbers) {
		numbers = await fetchAtmosphericNumbers(min, max, count);
		if (numbers) {
			source = "atmospheric";
		}
	}

	// Priority 3: Fall back to CSPRNG
	if (!numbers) {
		numbers = generateCSPRNGNumbers(min, max, count);
		source = "csprng";
	}

	// Make unique if requested
	if (options?.unique) {
		numbers = makeUnique(numbers, min, max);
	}

	return { numbers, source };
}

/**
 * Get human-readable source name
 */
export function getSourceDisplayName(source: RandomSource): string {
	switch (source) {
		case "quantum":
			return "ANU Quantum (양자 난수)";
		case "atmospheric":
			return "Random.org (대기 노이즈)";
		case "csprng":
			return "Web Crypto (CSPRNG)";
	}
}
