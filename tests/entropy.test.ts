import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	consumeFromPool,
	consumeUniqueFromPool,
	fetchEntropy,
} from "../src/services/seedPool";
import { env } from "./cloudflare.mock";

beforeEach(() => {
	env.ANU_API_KEY = "test-anu-key";
	env.RANDOM_ORG_API_KEY = "test-random-key";
	env.SEED_POOL.get = vi.fn(async () => {
		throw new Error("KV must not be used by draws");
	});
	env.SEED_POOL.put = vi.fn(async () => {});
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("request-owned entropy", () => {
	it("authenticates ANU and fetches only the requested batch", async () => {
		const request = vi.fn(async (url: string, init: RequestInit) => {
			expect(url).toBe(
				"https://api.quantumnumbers.anu.edu.au?length=2&type=uint16",
			);
			expect(init.headers).toEqual({ "x-api-key": "test-anu-key" });
			return Response.json({ success: true, data: [0, 65535] });
		});
		vi.stubGlobal("fetch", request);
		expect(await fetchEntropy(2)).toEqual({
			seeds: [0, 65535],
			source: "quantum",
		});
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("uses fresh data for simultaneous requests and never reads shared KV", async () => {
		let request = 0;
		const fetch = vi.fn(async (url: string) => {
			const count = Number(new URL(url).searchParams.get("length"));
			return Response.json({
				success: true,
				data: Array(count).fill(request++),
			});
		});
		vi.stubGlobal("fetch", fetch);
		const [first, second] = await Promise.all([
			consumeFromPool(1, 10000, 10),
			consumeFromPool(1, 10000, 10),
		]);
		expect(first.numbers).not.toEqual(second.numbers);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(env.SEED_POOL.get).not.toHaveBeenCalled();
		expect(env.SEED_POOL.put).not.toHaveBeenCalled();
	});
	it("falls back to keyed Random.org after an ANU failure", async () => {
		const fetch = vi.fn(async (url: string, init: RequestInit) => {
			if (url.includes("quantumnumbers"))
				return new Response(null, { status: 403 });
			expect(url).toBe("https://api.random.org/json-rpc/4/invoke");
			expect(init.method).toBe("POST");
			const body = JSON.parse(init.body as string);
			expect(body.params).toMatchObject({
				apiKey: "test-random-key",
				n: 2,
				min: 0,
				max: 65535,
			});
			return Response.json({ result: { random: { data: [5, 8] } } });
		});
		vi.stubGlobal("fetch", fetch);
		expect(await fetchEntropy(2)).toEqual({
			seeds: [5, 8],
			source: "atmospheric",
		});
	});
	it("uses public Random.org without either key", async () => {
		delete env.ANU_API_KEY;
		delete env.RANDOM_ORG_API_KEY;
		const fetch = vi.fn(async (url: string) => {
			expect(new URL(url).hostname).toBe("www.random.org");
			return new Response("0\n65535\n");
		});
		vi.stubGlobal("fetch", fetch);
		expect(await fetchEntropy(2)).toEqual({
			seeds: [0, 65535],
			source: "atmospheric",
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("rejects malformed external values and JSON-RPC errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url.includes("quantumnumbers")
					? Response.json({ success: true, data: [1, 65536] })
					: Response.json({ error: { code: 200, message: "Invalid key" } }),
			),
		);
		const batch = await fetchEntropy(2);
		expect(batch.source).toBe("csprng");
		expect(batch.seeds).toHaveLength(2);
	});
	it("returns the full unique count even when KV and both APIs fail", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 503 })),
		);
		vi.stubGlobal("crypto", {
			randomUUID: () => "test-request",
			getRandomValues: (values: Uint16Array) => values.fill(0),
		});
		const result = await consumeUniqueFromPool(1, 3, 3);
		expect(result.source).toBe("csprng");
		expect(result.numbers.sort()).toEqual([1, 2, 3]);
	});
	it("propagates validation errors without network calls or fallback", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await expect(consumeUniqueFromPool(1, 3, 4)).rejects.toThrow();
		expect(fetch).not.toHaveBeenCalled();
	});
	it("never logs credentials embedded in raw request failures", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error(
					`Request failed: ${env.ANU_API_KEY} ${env.RANDOM_ORG_API_KEY}`,
				);
			}),
		);
		await fetchEntropy(2);
		const warnings = JSON.stringify(vi.mocked(console.warn).mock.calls);
		expect(warnings).not.toContain("test-anu-key");
		expect(warnings).not.toContain("test-random-key");
	});
});
