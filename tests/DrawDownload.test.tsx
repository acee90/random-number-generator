// @vitest-environment jsdom

import { Blob as BufferBlob } from "node:buffer";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DrawDownload from "../src/components/features/DrawDownload";
import type { TextDraw } from "../src/lib/drawText";

const createObjectURL = vi.fn((_blob: Blob) => "blob:randomlab-test");
const revokeObjectURL = vi.fn((_url: string) => {});
const downloads: { filename: string; href: string; attached: boolean }[] = [];
const draw: TextDraw = {
	kind: "pension",
	timestamp: Date.parse("2026-11-10T15:00:03Z"),
	rows: [{ group: 3, numbers: [0, 0, 0, 0, 0, 7] }],
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
	createObjectURL.mockClear();
	revokeObjectURL.mockClear();
	downloads.length = 0;
	vi.stubGlobal("Blob", BufferBlob);
	vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
		this: HTMLAnchorElement,
	) {
		downloads.push({
			filename: this.download,
			href: this.href,
			attached: this.isConnected,
		});
	});
});

afterEach(() => {
	cleanup();
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function save() {
	fireEvent.click(screen.getByRole("button", { name: "텍스트로 저장" }));
}

describe("draw downloads", () => {
	it("downloads the displayed draw's saved time, source and strategy, then releases its URL", async () => {
		const view = render(
			<DrawDownload
				draw={draw}
				sourceLabel="ANU Quantum (양자 난수)"
				strategy="모든 조 · 같은 번호"
			/>,
		);
		save();
		expect(downloads).toEqual([
			{
				filename: "randomlab-pension-20261111-000003.txt",
				href: "blob:randomlab-test",
				attached: true,
			},
		]);
		const blob = createObjectURL.mock.calls[0][0] as unknown as BufferBlob;
		expect(blob.type).toBe("text/plain;charset=utf-8");
		const text = await blob.text();
		expect(text).toContain("생성 시각: 2026-11-11 00:00:03 (Asia/Seoul)");
		expect(text).toContain("난수 출처: ANU Quantum (양자 난수)");
		expect(text).toContain("추첨 방식: 모든 조 · 같은 번호");
		expect(text).toContain("1게임: 3조 000007");
		expect(document.querySelectorAll("a[download]")).toHaveLength(0);
		expect(revokeObjectURL).not.toHaveBeenCalled();
		view.unmount();
		vi.runOnlyPendingTimers();
		expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
			"blob:randomlab-test",
		);
	});

	it.each([
		undefined,
		{},
		{ createObjectURL },
	])("keeps an actionable error visible when URL downloads are unsupported: %j", (urlApi) => {
		vi.stubGlobal("URL", urlApi);
		render(<DrawDownload draw={draw} sourceLabel="Web Crypto (CSPRNG)" />);
		save();
		const error = screen.getByRole("alert");
		expect(error.textContent).toContain(
			"텍스트 파일을 저장하지 못했습니다. 결과를 복사해 간직해 주세요.",
		);
		expect(
			screen
				.getByRole("button", { name: "텍스트로 저장" })
				.getAttribute("aria-describedby"),
		).toBe(error.id);
		vi.advanceTimersByTime(60_000);
		expect(error.textContent).toContain("결과를 복사해");
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(downloads).toHaveLength(0);
	});

	it("shows a local error if Blob creation is unavailable", () => {
		vi.stubGlobal("Blob", undefined);
		render(<DrawDownload draw={draw} sourceLabel="Web Crypto (CSPRNG)" />);
		save();
		expect(screen.getByRole("alert").textContent).toContain("결과를 복사해");
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it("cleans up a created URL and link if the browser blocks the download action", () => {
		vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => {
			throw new Error("Download blocked");
		});
		render(<DrawDownload draw={draw} sourceLabel="Web Crypto (CSPRNG)" />);
		save();
		expect(screen.getByRole("alert").textContent).toContain("결과를 복사해");
		expect(document.querySelectorAll("a[download]")).toHaveLength(0);
		vi.runOnlyPendingTimers();
		expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
			"blob:randomlab-test",
		);
	});

	it("clears a previous error when a later save can start", () => {
		vi.stubGlobal("URL", {});
		render(<DrawDownload draw={draw} sourceLabel="Web Crypto (CSPRNG)" />);
		save();
		expect(screen.getByRole("alert").textContent).toContain(
			"저장하지 못했습니다",
		);
		vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
		save();
		expect(screen.getByRole("alert").textContent).toBe("");
		expect(downloads).toHaveLength(1);
	});
});
