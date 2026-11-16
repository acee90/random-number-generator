export type DiagnosticEnvironment = {
	LUNCH_ROOM_DIAGNOSTICS?: string;
	LUNCH_ROOM_LOCATION_HINT?: string;
};

/** Preview-only metadata; DO execution location must be checked in its trace. */
export function roomPlacementDiagnostics(
	request: Request & { cf?: { colo?: unknown } },
	response: Response,
	env: DiagnosticEnvironment,
): Response {
	if (env.LUNCH_ROOM_DIAGNOSTICS !== "enabled" || response.status === 101)
		return response;
	const headers = new Headers(response.headers);
	const placement = request.headers.get("cf-placement");
	if (placement && /^(?:local|remote)-[A-Z]{3}$/.test(placement))
		headers.set("x-room-worker-placement", placement);
	const colo = request.cf?.colo;
	if (typeof colo === "string" && /^[A-Z]{3}$/.test(colo))
		headers.set("x-room-request-colo", colo);
	headers.set(
		"x-room-location-hint",
		env.LUNCH_ROOM_LOCATION_HINT === "apac-ne" ? "apac-ne" : "default",
	);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
