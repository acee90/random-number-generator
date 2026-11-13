import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const origin = new URL(process.argv[2] ?? "http://localhost:3004").origin;
const canonicalOrigin = "https://jeommechu.dev";
const request = (path, options = {}) =>
	fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15000), ...options });
const report = (check, details) =>
	console.log(JSON.stringify({ check, ...details }));

async function checkPage(path, canonical) {
	const response = await request(path);
	assert.equal(response.status, 200, `${path}: HTTP status`);
	const document = new JSDOM(await response.text()).window.document;
	const meta = (key) =>
		document.querySelector(`meta[name="${key}"],meta[property="${key}"]`)
			?.content;
	assert.equal(document.documentElement.lang, "ko", `${path}: page language`);
	assert.equal(
		document.querySelectorAll("title").length,
		1,
		`${path}: unique title`,
	);
	assert(document.title.includes("점메추"), `${path}: brand title`);
	assert(meta("description")?.length > 0, `${path}: description`);
	assert.equal(
		document.querySelectorAll('link[rel="canonical"]').length,
		canonical ? 1 : 0,
	);
	assert.equal(
		document.querySelector('link[rel="canonical"]')?.href ?? null,
		canonical,
	);
	assert.equal(
		meta("robots"),
		canonical ? "index, follow" : "noindex, nofollow",
	);
	if (!canonical)
		assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
	assert.equal(meta("og:title"), document.title);
	assert.equal(meta("twitter:title"), document.title);
	assert.equal(meta("og:image"), `${canonicalOrigin}/og-jeommechu.png`);
	assert.equal(meta("twitter:image"), meta("og:image"));
	assert.equal(meta("og:image:width"), "1200");
	assert.equal(meta("og:image:height"), "630");
	assert.deepEqual(
		[
			...document.querySelectorAll(
				".site-header-nav a,.site-header-nav button",
			),
		].map((element) => element.textContent.trim()),
		["점메추"],
	);
	report("page", {
		path,
		status: response.status,
		canonical,
		robots: meta("robots"),
	});
}

async function main() {
	await Promise.all(
		[
			["/", `${canonicalOrigin}/`],
			["/solo", `${canonicalOrigin}/solo`],
			["/tools?tool=number", null],
			["/tools?tool=lotto", null],
			["/tools?tool=pension", null],
			["/lunch-room/12345678-abcd-4abc-8abc-123456789012", null],
		].map(([path, canonical]) => checkPage(path, canonical)),
	);
	const [robots, sitemap, image, verification, manifest] = await Promise.all(
		[
			"/robots.txt",
			"/sitemap.xml",
			"/og-jeommechu.png",
			"/naver593f51ab9c1bd96c45ef4d8f8be99cca.html",
			"/manifest.json",
		].map((path) => request(path)),
	);
	for (const response of [robots, sitemap, image, verification, manifest])
		assert.equal(response.status, 200);
	assert((await robots.text()).includes(`${canonicalOrigin}/sitemap.xml`));
	const xml = new JSDOM(await sitemap.text(), {
		contentType: "application/xml",
	}).window.document;
	assert.deepEqual(
		[...xml.querySelectorAll("loc")]
			.map((element) => element.textContent)
			.sort(),
		[`${canonicalOrigin}/`, `${canonicalOrigin}/solo`].sort(),
	);
	assert(image.headers.get("Content-Type")?.includes("image/png"));
	const bytes = Buffer.from(await image.arrayBuffer());
	assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	assert.equal(bytes.readUInt32BE(16), 1200);
	assert.equal(bytes.readUInt32BE(20), 630);
	const appManifest = await manifest.json();
	assert(appManifest.name?.startsWith("점메추"));
	assert.equal(appManifest.short_name, "점메추");
	assert.equal(appManifest.start_url, "/");
	assert.equal(appManifest.lang, "ko");
	assert(appManifest.icons?.length > 0);
	const redirect = await request("/lunch", { redirect: "manual" });
	assert.equal(redirect.status, 301);
	assert.equal(new URL(redirect.headers.get("Location"), origin).pathname, "/");
	report("assets", {
		robots: true,
		sitemap: true,
		socialImage: "1200x630",
		verification: true,
		manifest: true,
		legacyRedirect: 301,
	});
	report("complete", { pages: 6, origin });
}

await main().catch((error) => {
	// Response bodies, authentication data and raw network errors are never logged.
	console.error(
		JSON.stringify({
			check: "failed",
			reason:
				error instanceof assert.AssertionError
					? error.message
					: "Network or response check failed",
		}),
	);
	process.exitCode = 1;
});
