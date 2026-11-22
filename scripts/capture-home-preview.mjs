// npm run capture:home — uses installed Chrome, or set CHROME_PATH to a Chromium executable.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "src/assets/home-preview");
const scenes = [
	["host", ".lunch-wheel-center[data-draw-permission=host]"],
	["guest", ".room-recommend-form input"],
	["result", ".room-result-summary h3"],
];
const formats = [
	{ name: "wide", width: 1080, height: 640 },
	{ name: "compact", width: 420, height: 640 },
];

const server = await createServer({
	root,
	configFile: path.join(root, ".storybook/vite.config.ts"),
	cacheDir: "node_modules/.vite-home-preview",
	logLevel: "error",
	server: { host: "127.0.0.1", port: 0, open: false, hmr: false },
});
let browser;
try {
	await server.listen();
	const origin = server.resolvedUrls.local[0];
	browser = await chromium.launch(
		process.env.CHROME_PATH
			? { executablePath: process.env.CHROME_PATH }
			: { channel: "chrome" },
	);
	const images = [];
	for (const { name, width, height } of formats) {
		const page = await browser.newPage({
			viewport: { width, height },
			locale: "ko-KR",
			timezoneId: "Asia/Seoul",
			reducedMotion: "reduce",
			deviceScaleFactor: 1.5,
		});
		await page.clock.setFixedTime(new Date("2026-11-20T03:12:00Z"));
		for (const [view, ready] of scenes) {
			await page.goto(
				new URL(`scripts/home-preview/fixture.html?view=${view}`, origin).href,
			);
			await page.locator(ready).first().waitFor();
			if (name === "compact")
				await page.getByRole("button", { name: "채팅 접기" }).click();
			if (view === "guest") {
				const suggestion = await page
					.locator("#room-capture")
					.getAttribute("data-recommendation");
				await page.locator(ready).fill(suggestion);
				await page.locator(ready).blur();
			}
			if (view !== "guest") {
				const phase = view === "host" ? "idle" : "result";
				await page.locator(`canvas[data-scene="${phase}"][data-painted]`).waitFor();
			}
			await page.evaluate(() => document.fonts.ready);
			const frame = await page.screenshot({ animations: "disabled" });
			images.push([
				path.join(output, `${view}-${name}.webp`),
				await sharp(frame).webp({ quality: 88, effort: 6 }).toBuffer(),
			]);
		}
		await page.close();
	}
	// Capture the complete set before replacing anything if a real screen has changed.
	await mkdir(output, { recursive: true });
	for (const [file, image] of images) await writeFile(file, image);
	console.log(
		`Updated ${images.length} room previews in src/assets/home-preview`,
	);
} finally {
	await browser?.close();
	await server.close();
}
