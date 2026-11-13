// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	HeadContent,
	RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	createSeoHead,
	lunchPageSeo,
	siteOrigin,
	socialImage,
} from "../src/lib/seo";
import { Route as RootRoute } from "../src/routes/__root";
import { Route as HomeRoute } from "../src/routes/index";
import { Route as RoomRoute } from "../src/routes/lunch-room.$roomId";
import { Route as SoloRoute } from "../src/routes/solo";
import { Route as ToolsRoute } from "../src/routes/tools";

vi.mock("../src/styles.css?url", () => ({ default: "/styles.css" }));

async function renderedHead(path: "/" | "/solo" | "/lunch-room/$roomId") {
	const root = createRootRoute({
		head: async () => (await RootRoute.options.head?.({} as never)) ?? {},
		component: HeadContent,
	});
	const source =
		path === "/" ? HomeRoute : path === "/solo" ? SoloRoute : RoomRoute;
	const route = createRoute({
		getParentRoute: () => root,
		path,
		head: async () => (await source.options.head?.({} as never)) ?? {},
	});
	const router = createRouter({
		routeTree: root.addChildren([route]),
		history: createMemoryHistory({
			initialEntries: [path.replace("$roomId", "private-room-identifier")],
		}),
		isServer: true,
	});
	await router.load();
	const html = renderToStaticMarkup(<RouterProvider router={router} />);
	return new DOMParser().parseFromString(html, "text/html");
}

describe("public lunch pages and private room metadata", () => {
	it.each([
		"/",
		"/solo",
	] as const)("renders one route-specific title/canonical and matching share metadata for %s", async (path) => {
		const page = path === "/" ? lunchPageSeo.home : lunchPageSeo.solo;
		const document = await renderedHead(path);
		expect(document.querySelectorAll("title")).toHaveLength(1);
		expect(document.title).toBe(page.title);
		expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
		expect(
			document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
		).toBe(`${siteOrigin}${path}`);
		for (const key of ["description", "twitter:description"])
			expect(
				document.querySelector(`meta[name="${key}"]`)?.getAttribute("content"),
			).toBe(page.description);
		expect(
			document
				.querySelector('meta[property="og:title"]')
				?.getAttribute("content"),
		).toBe(page.title);
		expect(
			document
				.querySelector('meta[property="og:url"]')
				?.getAttribute("content"),
		).toBe(`${siteOrigin}${path}`);
		expect(
			document
				.querySelector('meta[property="og:description"]')
				?.getAttribute("content"),
		).toBe(page.description);
		expect(
			document.querySelector('meta[name="robots"]')?.getAttribute("content"),
		).toBe("index, follow");
		for (const selector of [
			'meta[property="og:image"]',
			'meta[name="twitter:image"]',
		])
			expect(document.querySelector(selector)?.getAttribute("content")).toBe(
				socialImage,
			);
	});

	it("does not inherit public indexing, canonical or private identifiers into a shared room head", async () => {
		const document = await renderedHead("/lunch-room/$roomId");
		expect(
			document.querySelector('meta[name="robots"]')?.getAttribute("content"),
		).toBe("noindex, nofollow");
		expect(document.querySelector('link[rel="canonical"]')).toBeNull();
		expect(document.querySelector('meta[property="og:url"]')).toBeNull();
		expect(document.documentElement.innerHTML).not.toContain(
			"private-room-identifier",
		);
		expect(document.title).toBe(lunchPageSeo.room.title);
	});

	it("keeps uncategorized and hidden tool metadata private by default", () => {
		const head = createSeoHead({
			title: "추가 도구",
			description: "도구 설명",
		});
		expect(head.links).toEqual([]);
		expect(
			head.meta.find((item) => "name" in item && item.name === "robots"),
		).toEqual({ name: "robots", content: "noindex, nofollow" });
		expect(
			head.meta.some(
				(item) => "property" in item && item.property === "og:url",
			),
		).toBe(false);
	});

	it("sends noindex response headers for room pages and hidden tools", async () => {
		for (const route of [RoomRoute, ToolsRoute]) {
			const headers = await route.options.headers?.({} as never);
			expect(headers?.["X-Robots-Tag"]).toBe("noindex, nofollow");
		}
	});

	it("lists only public lunch routes and lets crawlers read private page noindex tags", () => {
		const sitemap = readFileSync(resolve("public/sitemap.xml"), "utf8");
		const robots = readFileSync(resolve("public/robots.txt"), "utf8");
		const xml = new DOMParser().parseFromString(sitemap, "text/xml");
		expect(xml.querySelector("parsererror")).toBeNull();
		expect(
			Array.from(xml.querySelectorAll("loc"), (element) => element.textContent),
		).toEqual([`${siteOrigin}/`, `${siteOrigin}/solo`]);
		expect(robots).toContain(`Sitemap: ${siteOrigin}/sitemap.xml`);
		expect(robots).toContain("Disallow: /api/");
		expect(robots).toContain("Disallow: /parties/");
		expect(robots).not.toMatch(/Disallow:\s*\/(?:lunch-room|tools)/);
	});
});
