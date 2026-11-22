import { describe, expect, it } from "vitest";
import { handlePublicMapConfigRequest } from "../src/server/publicMapConfig";

const configUrl = "https://example.com/api/public-config";

describe("public map config endpoint", () => {
	it("returns only the trimmed Naver Maps client ID without caching", async () => {
		const response = handlePublicMapConfigRequest(new Request(configUrl), {
			VITE_NAVER_MAPS_KEY_ID: " test-client-id ",
		});
		if (!response) throw new Error("Expected public map config response");

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({
			naverMapsClientId: "test-client-id",
		});
	});

	it("does not expose the value when it is not configured", async () => {
		const response = handlePublicMapConfigRequest(new Request(configUrl), {});
		if (!response) throw new Error("Expected public map config response");

		expect(await response.json()).toEqual({ naverMapsClientId: null });
	});

	it("accepts GET only", async () => {
		const response = handlePublicMapConfigRequest(
			new Request(configUrl, { method: "POST" }),
			{},
		);
		if (!response) throw new Error("Expected public map config response");

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
	});

	it("does not intercept other routes", () => {
		expect(
			handlePublicMapConfigRequest(new Request("https://example.com/solo"), {}),
		).toBeNull();
	});
});
