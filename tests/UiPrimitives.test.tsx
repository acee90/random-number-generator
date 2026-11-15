// @vitest-environment jsdom

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "../src/components/ui/alert-dialog";
import { Button } from "../src/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "../src/components/ui/dialog";
import { Input } from "../src/components/ui/input";
import { Label } from "../src/components/ui/label";
import { NativeSelect } from "../src/components/ui/native-select";
import { Textarea } from "../src/components/ui/textarea";

afterEach(cleanup);

describe("shared UI behavior", () => {
	it("keeps ordinary actions out of form submission and supports explicit submit", () => {
		const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
		render(
			<form onSubmit={submit}>
				<Button>목록 비우기</Button>
				<Button type="submit">저장</Button>
			</form>,
		);
		fireEvent.click(screen.getByRole("button", { name: "목록 비우기" }));
		expect(submit).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		expect(submit).toHaveBeenCalledOnce();
	});

	it("composes navigation and native form controls without losing refs or semantics", () => {
		const buttonRef = createRef<HTMLButtonElement>();
		const inputRef = createRef<HTMLInputElement>();
		const selectRef = createRef<HTMLSelectElement>();
		const textareaRef = createRef<HTMLTextAreaElement>();
		render(
			<>
				<Button asChild>
					<a href="/create">방 만들기</a>
				</Button>
				<Button ref={buttonRef}>추가</Button>
				<Label htmlFor="list-name">목록 이름</Label>
				<Input id="list-name" ref={inputRef} defaultValue="팀 점심" />
				<Label htmlFor="category">분류</Label>
				<NativeSelect id="category" ref={selectRef} defaultValue="한식">
					<option>한식</option>
					<option>일식</option>
				</NativeSelect>
				<Label htmlFor="memo">메모</Label>
				<Textarea id="memo" ref={textareaRef} />
			</>,
		);
		const link = screen.getByRole("link", { name: "방 만들기" });
		expect(link.getAttribute("href")).toBe("/create");
		expect(link.hasAttribute("type")).toBe(false);
		expect(link.closest("button")).toBeNull();
		expect(buttonRef.current).toBe(
			screen.getByRole("button", { name: "추가" }),
		);
		expect(inputRef.current).toBe(screen.getByLabelText("목록 이름"));
		expect(selectRef.current).toBe(screen.getByLabelText("분류"));
		expect(textareaRef.current).toBe(screen.getByLabelText("메모"));
		inputRef.current?.focus();
		expect(document.activeElement).toBe(inputRef.current);
	});

	it("gives dialogs an accessible name and closes with Escape while restoring focus", async () => {
		render(
			<Dialog>
				<DialogTrigger asChild>
					<Button>편집 열기</Button>
				</DialogTrigger>
				<DialogContent>
					<DialogTitle>목록 편집</DialogTitle>
					<DialogDescription>목록을 수정합니다.</DialogDescription>
					<Input aria-label="후보 이름" />
				</DialogContent>
			</Dialog>,
		);
		const trigger = screen.getByRole("button", { name: "편집 열기" });
		trigger.focus();
		fireEvent.click(trigger);
		const dialog = screen.getByRole("dialog", { name: "목록 편집" });
		expect(dialog.contains(document.activeElement)).toBe(true);
		await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});

	it("focuses the safe cancel action and requires confirmation before clearing", async () => {
		const clear = vi.fn();
		render(
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<Button>전체 비우기</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogTitle>후보를 비울까요?</AlertDialogTitle>
					<AlertDialogDescription>
						편집 중인 항목을 모두 지웁니다.
					</AlertDialogDescription>
					<AlertDialogCancel>돌아가기</AlertDialogCancel>
					<AlertDialogAction onClick={clear}>비우기</AlertDialogAction>
				</AlertDialogContent>
			</AlertDialog>,
		);
		const trigger = screen.getByRole("button", { name: "전체 비우기" });
		fireEvent.click(trigger);
		expect(
			screen.getByRole("alertdialog", { name: "후보를 비울까요?" }),
		).toBeTruthy();
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "돌아가기" }),
		);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "돌아가기" })),
		);
		expect(clear).not.toHaveBeenCalled();
		fireEvent.click(trigger);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "비우기" })),
		);
		expect(clear).toHaveBeenCalledOnce();
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});
});
