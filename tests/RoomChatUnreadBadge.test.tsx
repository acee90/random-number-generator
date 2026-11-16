// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RoomChatUnreadBadge from "../src/components/features/RoomChatUnreadBadge";

afterEach(cleanup);

describe("RoomChatUnreadBadge", () => {
	it("keeps an empty announcement region mounted and shows only a number when unread messages arrive", () => {
		const view = render(<RoomChatUnreadBadge count={0} id="unread-count" />);
		const status = screen.getByRole("status");
		expect(status.textContent).toBe("");
		expect(
			view.container.querySelector(".room-chat-unread")?.hasAttribute("hidden"),
		).toBe(true);
		view.rerender(<RoomChatUnreadBadge count={3} id="unread-count" />);
		expect(screen.getByRole("status")).toBe(status);
		expect(status.id).toBe("unread-count");
		expect(status.textContent).toBe("새 메시지 3개");
		const badge = view.container.querySelector(".room-chat-unread");
		expect(badge?.textContent).toBe("3");
		expect(badge?.hasAttribute("hidden")).toBe(false);
		expect(badge?.getAttribute("aria-hidden")).toBe("true");
	});

	it("nudges once on increases but never on first render, unchanged counts or decreases", () => {
		const view = render(<RoomChatUnreadBadge count={2} />);
		const count = () =>
			view.container.querySelector(".room-chat-unread-count") as HTMLElement;
		expect(count().hasAttribute("data-arrival")).toBe(false);
		view.rerender(<RoomChatUnreadBadge count={4} />);
		const arriving = count();
		expect(arriving.getAttribute("data-arrival")).toBe("new");
		fireEvent.animationEnd(arriving);
		expect(count().hasAttribute("data-arrival")).toBe(false);
		view.rerender(<RoomChatUnreadBadge count={4} />);
		expect(count()).toBe(arriving);
		expect(count().hasAttribute("data-arrival")).toBe(false);
		view.rerender(<RoomChatUnreadBadge count={1} />);
		expect(count().hasAttribute("data-arrival")).toBe(false);
		view.rerender(<RoomChatUnreadBadge count={5} />);
		expect(count()).not.toBe(arriving);
		expect(count().getAttribute("data-arrival")).toBe("new");
		expect(count().textContent).toBe("5");
		view.rerender(<RoomChatUnreadBadge count={0} />);
		expect(count().hasAttribute("data-arrival")).toBe(false);
		expect(screen.getByRole("status").textContent).toBe("");
	});

	it("caps the visible badge while retaining the exact accessible count", () => {
		const view = render(<RoomChatUnreadBadge count={123} />);
		expect(view.container.querySelector(".room-chat-unread")?.textContent).toBe(
			"99+",
		);
		expect(screen.getByRole("status").textContent).toBe("새 메시지 123개");
	});

	it("lets a labelled parent button reuse the numeric badge without duplicate live announcements", () => {
		const view = render(<RoomChatUnreadBadge count={8} announce={false} />);
		expect(screen.queryByRole("status")).toBeNull();
		expect(view.container.querySelector(".room-chat-unread")?.textContent).toBe(
			"8",
		);
	});
});
