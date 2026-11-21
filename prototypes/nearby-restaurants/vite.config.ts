import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type Connect, defineConfig } from "vite";
import { NEARBY_API_PATH, searchRestaurants } from "./nearby.ts";

const nearbyApi: Connect.NextHandleFunction = async (request, response) => {
	response.setHeader("Cache-Control", "no-store");
	if (request.method !== "GET") {
		response.statusCode = 405;
		response.setHeader("Allow", "GET");
		response.end();
		return;
	}

	const { searchParams } = new URL(request.url || "/", "http://localhost");
	const latitude = Number(searchParams.get("lat")?.trim() || Number.NaN);
	const longitude = Number(searchParams.get("lon")?.trim() || Number.NaN);
	if (
		!Number.isFinite(latitude) ||
		!Number.isFinite(longitude) ||
		Math.abs(latitude) > 90 ||
		Math.abs(longitude) > 180
	) {
		response.statusCode = 400;
		response.end();
		return;
	}

	try {
		const restaurants = await searchRestaurants({ latitude, longitude });
		response.setHeader("Content-Type", "application/json; charset=utf-8");
		response.end(JSON.stringify(restaurants));
	} catch {
		response.statusCode = 502;
		response.end();
	}
};

function installNearbyApi({ middlewares }: { middlewares: Connect.Server }) {
	middlewares.use(NEARBY_API_PATH, nearbyApi);
}

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	cacheDir: "../../node_modules/.vite-nearby-restaurants",
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "nearby-restaurants",
			configureServer: installNearbyApi,
			configurePreviewServer: installNearbyApi,
		},
	],
	resolve: {
		alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
	},
	server: { host: "127.0.0.1", port: 4176, strictPort: true },
});
