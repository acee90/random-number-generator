// @vitest-environment jsdom

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { getSsrStatus } from "@tanstack/react-router/ssr/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Route } from "../src/routes/__root";

describe("missing page recovery", () => {
	it("keeps a 404 response while providing an accessible route home", async () => {
		const root = createRootRoute({
			notFoundComponent: Route.options.notFoundComponent,
		});
		const index = createRoute({
			getParentRoute: () => root,
			path: "/",
			component: () => null,
		});
		const router = createRouter({
			isServer: true,
			routeTree: root.addChildren([index]),
			history: createMemoryHistory({ initialEntries: ["/missing"] }),
		});
		await router.load();

		expect(getSsrStatus(router)).toBe(404);
		const html = renderToStaticMarkup(
			createElement(RouterProvider, { router }),
		);
		const container = document.createElement("div");
		container.innerHTML = html;
		const main = container.querySelector("main#main-content");
		expect(main).not.toBeNull();
		expect(main?.getAttribute("tabindex")).toBe("-1");
		expect(main?.querySelector("h1")?.textContent).toBe(
			"페이지를 찾을 수 없습니다",
		);
		const home = main?.querySelector("a");
		expect(home?.getAttribute("href")).toBe("/");
		expect(home?.textContent).toContain("홈으로 이동");
	});
});
