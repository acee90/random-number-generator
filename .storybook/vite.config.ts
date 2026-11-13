import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Component previews use browser code, without the app's Worker or server plugins.
export default defineConfig({
	publicDir: false,
	plugins: [tailwindcss()],
	server: {
		watch: {
			ignored: [
				"**/storybook-static/**",
				"**/dist/**",
				"**/.wrangler/**",
				"**/.tanstack/**",
				"**/.agents/**",
				"**/.codex/**",
				"**/.taste-skill/**",
			],
		},
	},
	resolve: {
		alias: [
			{
				// Reuse the real labels without pulling server-only API exports into a story.
				find: /^@\/services\/randomService$/,
				replacement: fileURLToPath(
					new URL("../src/lib/randomSource.ts", import.meta.url),
				),
			},
			{
				// The full page keeps its real UI and consumes a local room in Storybook.
				find: /^@\/hooks\/useLunchRoom$/,
				replacement: fileURLToPath(
					new URL("../stories/core/room-page-fixture.tsx", import.meta.url),
				),
			},
			{
				find: "@",
				replacement: fileURLToPath(new URL("../src", import.meta.url)),
			},
		],
	},
});
