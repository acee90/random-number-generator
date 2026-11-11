// @vitest-environment jsdom

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRouter } from "../src/router";

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function testRouter(options: {
	loader?: () => Promise<unknown>;
	component: () => React.ReactNode;
}) {
	const root = createRootRoute();
	const page = createRoute({
		getParentRoute: () => root,
		path: "/retry",
		...options,
	});
	return createRouter({
		routeTree: root.addChildren([page]),
		history: createMemoryHistory({ initialEntries: ["/retry"] }),
		defaultErrorComponent: getRouter().options.defaultErrorComponent,
	});
}

describe("route error recovery", () => {
	it("reloads a failed child loader without exposing its internal error", async () => {
		const loader = vi
			.fn()
			.mockRejectedValueOnce(new Error("internal request details"))
			.mockResolvedValue({});
		const router = testRouter({
			loader,
			component: () => <h1>추첨 도구를 다시 사용할 수 있습니다</h1>,
		});
		render(<RouterProvider router={router} />);

		await screen.findByRole("heading", {
			name: "화면을 열 수 없습니다",
		});
		expect(screen.queryByText(/internal request details/)).toBeNull();
		expect(document.activeElement).toBe(
			document.querySelector("main#main-content"),
		);
		expect(
			screen.getByRole("link", { name: "홈으로 이동" }).getAttribute("href"),
		).toBe("/");
		fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

		await screen.findByRole("heading", {
			name: "추첨 도구를 다시 사용할 수 있습니다",
		});
		expect(loader).toHaveBeenCalledTimes(2);
		await waitFor(() => expect(router.state.statusCode).toBe(200));
	});

	it("resets a child render error boundary when retrying", async () => {
		let failRender = true;
		const router = testRouter({
			component: () => {
				if (failRender) throw new Error("private render stack");
				return <h1>화면을 다시 표시했습니다</h1>;
			},
		});
		render(<RouterProvider router={router} />);

		await screen.findByRole("heading", {
			name: "화면을 열 수 없습니다",
		});
		expect(screen.queryByText(/private render stack/)).toBeNull();
		failRender = false;
		fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

		await screen.findByRole("heading", { name: "화면을 다시 표시했습니다" });
	});
});
