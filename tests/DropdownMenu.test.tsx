// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "../src/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../src/components/ui/dropdown-menu";

afterEach(cleanup);

function Example({ onSelect = () => {} }: { onSelect?: () => void }) {
	return (
		<>
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<Button aria-label="비빔밥 후보 관리">⋯</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuLabel>등록자 · 방장</DropdownMenuLabel>
					<DropdownMenuItem onSelect={onSelect}>
						이번 추첨에서 제외
					</DropdownMenuItem>
					<DropdownMenuItem disabled>저장 중인 작업</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive">후보 삭제</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Button>다른 작업</Button>
		</>
	);
}

async function openMenu() {
	const trigger = screen.getByRole("button", { name: "비빔밥 후보 관리" });
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "ArrowDown" });
	const first = await screen.findByRole("menuitem", {
		name: "이번 추첨에서 제외",
	});
	await waitFor(() => expect(document.activeElement).toBe(first));
	return { trigger, first };
}

it("opens an anchored menu and supports keyboard navigation and Escape focus restoration", async () => {
	render(<Example />);
	const { trigger, first } = await openMenu();
	expect(screen.getByRole("menu", { name: "비빔밥 후보 관리" })).toBeTruthy();
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(trigger.getAttribute("aria-expanded")).toBe("true");
	const last = screen.getByRole("menuitem", { name: "후보 삭제" });
	fireEvent.keyDown(first, { key: "ArrowDown" });
	await waitFor(() => expect(document.activeElement).toBe(last));
	fireEvent.keyDown(last, { key: "Home" });
	await waitFor(() => expect(document.activeElement).toBe(first));
	fireEvent.keyDown(first, { key: "End" });
	await waitFor(() => expect(document.activeElement).toBe(last));
	fireEvent.keyDown(last, { key: "Escape" });
	await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	await waitFor(() => expect(document.activeElement).toBe(trigger));
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("dismisses on outside interaction without invoking a candidate action", async () => {
	const onSelect = vi.fn();
	render(<Example onSelect={onSelect} />);
	await openMenu();
	fireEvent.pointerDown(screen.getByRole("button", { name: "다른 작업" }));
	await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	expect(onSelect).not.toHaveBeenCalled();
});

it("activates the chosen candidate action once and closes the menu", async () => {
	const onSelect = vi.fn();
	render(<Example onSelect={onSelect} />);
	const { first, trigger } = await openMenu();
	fireEvent.keyDown(first, { key: "Enter" });
	await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	expect(onSelect).toHaveBeenCalledOnce();
	await waitFor(() => expect(document.activeElement).toBe(trigger));
});
