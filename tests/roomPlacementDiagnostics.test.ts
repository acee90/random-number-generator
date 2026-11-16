import { describe, expect, it } from "vitest";
import { roomPlacementDiagnostics } from "../src/server/roomPlacementDiagnostics";

describe("room placement preview diagnostics", () => {
	it("keeps ordinary production responses untouched", () => {
		const request = new Request("https://example.com");
		const response = Response.json({ available: true });
		expect(roomPlacementDiagnostics(request, response, {})).toBe(response);
	});

	it("adds only bounded location fields while retaining the response", async () => {
		const request = Object.assign(
			new Request("https://example.com", {
				headers: { "cf-placement": "remote-ICN", "x-private": "secret" },
			}),
			{ cf: { colo: "LAX" } },
		);
		const response = roomPlacementDiagnostics(
			request,
			Response.json(
				{ available: true },
				{ headers: { "Cache-Control": "no-store" } },
			),
			{
				LUNCH_ROOM_DIAGNOSTICS: "enabled",
				LUNCH_ROOM_LOCATION_HINT: "apac-ne",
			},
		);
		expect(response.headers.get("x-room-worker-placement")).toBe("remote-ICN");
		expect(response.headers.get("x-room-request-colo")).toBe("LAX");
		expect(response.headers.get("x-room-location-hint")).toBe("apac-ne");
		expect(response.headers.get("x-private")).toBeNull();
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toEqual({ available: true });
	});

	it("does not reflect unrecognized header or colo values", () => {
		const request = Object.assign(
			new Request("https://example.com", {
				headers: { "cf-placement": "secret-value" },
			}),
			{ cf: { colo: "invalid-private-value" } },
		);
		const response = roomPlacementDiagnostics(request, new Response("ok"), {
			LUNCH_ROOM_DIAGNOSTICS: "enabled",
		});
		expect(response.headers.get("x-room-worker-placement")).toBeNull();
		expect(response.headers.get("x-room-request-colo")).toBeNull();
		expect(response.headers.get("x-room-location-hint")).toBe("default");
	});

	it("leaves WebSocket upgrades intact", () => {
		const upgrade = { status: 101 } as Response;
		expect(
			roomPlacementDiagnostics(new Request("https://example.com"), upgrade, {
				LUNCH_ROOM_DIAGNOSTICS: "enabled",
			}),
		).toBe(upgrade);
	});
});
