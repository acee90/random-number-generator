type NaverMapsEnvironment = {
	VITE_NAVER_MAPS_KEY_ID?: string;
};

const publicConfigPath = "/api/public-config";

export function handlePublicMapConfigRequest(
	request: Request,
	env: NaverMapsEnvironment,
): Response | null {
	if (new URL(request.url).pathname !== publicConfigPath) return null;
	if (request.method !== "GET")
		return new Response(null, {
			status: 405,
			headers: { Allow: "GET" },
		});

	return new Response(
		JSON.stringify({
			naverMapsClientId: env.VITE_NAVER_MAPS_KEY_ID?.trim() || null,
		}),
		{
			headers: {
				"Cache-Control": "no-store",
				"Content-Type": "application/json; charset=utf-8",
				"X-Content-Type-Options": "nosniff",
			},
		},
	);
}
