import { describe, expect, it, vi } from "vitest";
import {
	candidateLibraryKey,
	deleteCandidateList,
	readCandidateLibrary,
	saveCandidateList,
} from "../src/lib/candidateLibrary";
import {
	type CandidateListDraft,
	candidateDraftLimits,
} from "../src/lib/candidateListDraft";

function draft(): CandidateListDraft {
	return {
		id: "source-list",
		name: "  우리 팀 점심  ",
		items: [
			{ id: "first", name: "  국밥집  ", category: "한식", included: true },
			{ id: "second", name: "국밥집", category: "", included: false },
		],
	};
}
function storage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => values.set(key, value)),
	};
}

describe("service candidate library", () => {
	it("saves fresh copies without overwriting originals or merging equal names", () => {
		const target = storage();
		const input = draft();
		const before = structuredClone(input);
		const first = saveCandidateList(input, target);
		const second = saveCandidateList(input, target);
		expect(first.id).not.toBe(input.id);
		expect(second.id).not.toBe(first.id);
		expect(first.name).toBe("우리 팀 점심");
		expect(first.items.map((item) => item.name)).toEqual(["국밥집", "국밥집"]);
		expect(readCandidateLibrary(target).lists).toEqual([first, second]);
		expect(input).toEqual(before);
		first.items[0].name = "edited outside storage";
		expect(readCandidateLibrary(target).lists[0].items[0].name).toBe("국밥집");
	});

	it("uses its service namespace without touching Storybook or identity data", () => {
		const initial = {
			"jeommechu:storybook:candidate-lists:v1": "preview untouched",
			"jeommechu.room.host-proof": "proof untouched",
		};
		const target = storage(initial);
		saveCandidateList(draft(), target);
		expect(target.setItem.mock.calls.map(([key]) => key)).toEqual([
			candidateLibraryKey,
		]);
		for (const [key, value] of Object.entries(initial))
			expect(target.values.get(key)).toBe(value);
	});

	it("allows one candidate, optional and custom categories, and room metadata", () => {
		const value = draft();
		value.items = [
			{
				...value.items[0],
				category: "우리 팀 추천",
				menu: "점심 메뉴".repeat(25),
				distanceMeters: 0,
			},
		];
		const target = storage();
		const saved = saveCandidateList(value, target);
		expect(readCandidateLibrary(target).lists).toEqual([saved]);
		expect(saved.items).toHaveLength(1);
		expect(saved.items[0].category).toBe("우리 팀 추천");
	});

	it.each([
		"{",
		"null",
		'{"version":2,"lists":[]}',
	])("preserves corrupt storage and refuses to save over it: %s", (raw) => {
		const target = storage({ [candidateLibraryKey]: raw });
		expect(readCandidateLibrary(target)).toMatchObject({ lists: [] });
		expect(readCandidateLibrary(target).error).toContain("다시 시도");
		expect(() => saveCandidateList(draft(), target)).toThrow("기존 저장 내용");
		expect(() => deleteCandidateList("first", target)).toThrow(
			"기존 저장 내용",
		);
		expect(target.setItem).not.toHaveBeenCalled();
		expect(target.values.get(candidateLibraryKey)).toBe(raw);
	});

	it("keeps all twenty saved lists when full and allows another save after one deletion", () => {
		const target = storage();
		for (let i = 0; i < candidateDraftLimits.savedLists; i++)
			saveCandidateList(draft(), target);
		const before = target.values.get(candidateLibraryKey);
		expect(() => saveCandidateList(draft(), target)).toThrow("20개");
		expect(target.values.get(candidateLibraryKey)).toBe(before);
		expect(target.setItem).toHaveBeenCalledTimes(20);
		const originals = readCandidateLibrary(target).lists;
		expect(deleteCandidateList(originals[0].id, target)).toBe(true);
		const next = saveCandidateList(draft(), target);
		expect(readCandidateLibrary(target).lists).toEqual([
			...originals.slice(1),
			next,
		]);
	});

	it.each([
		[
			"empty candidates",
			(value: CandidateListDraft) => {
				value.items = [];
			},
		],
		[
			"blank list name",
			(value: CandidateListDraft) => {
				value.name = " ";
			},
		],
		[
			"blank candidate name",
			(value: CandidateListDraft) => {
				value.items[0].name = " ";
			},
		],
		[
			"duplicate IDs",
			(value: CandidateListDraft) => {
				value.items[1].id = value.items[0].id;
			},
		],
		[
			"bad category controls",
			(value: CandidateListDraft) => {
				value.items[0].category = "한\u0000식";
			},
		],
		[
			"lone surrogate",
			(value: CandidateListDraft) => {
				value.items[0].name = "\ud800";
			},
		],
		[
			"oversized category",
			(value: CandidateListDraft) => {
				value.items[0].category = "x".repeat(25);
			},
		],
		[
			"fractional distance",
			(value: CandidateListDraft) => {
				value.items[0].distanceMeters = 0.5;
			},
		],
	] as const)("rejects %s without writing", (_, invalidate) => {
		const value = draft();
		invalidate(value);
		const target = storage();
		expect(() => saveCandidateList(value, target)).toThrow();
		expect(target.setItem).not.toHaveBeenCalled();
	});

	it("does not mutate input or old data when browser writes fail", () => {
		const input = draft();
		const before = structuredClone(input);
		const target = storage();
		target.setItem.mockImplementation(() => {
			throw new Error("Quota exceeded");
		});
		expect(() => saveCandidateList(input, target)).toThrow("현재 후보는 유지");
		expect(input).toEqual(before);
		expect(target.values.size).toBe(0);
	});

	it("reports blocked reads and avoids writes", () => {
		const target = storage();
		target.getItem.mockImplementation(() => {
			throw new Error("Blocked");
		});
		expect(readCandidateLibrary(target).error).toContain("저장소 권한");
		expect(() => saveCandidateList(draft(), target)).toThrow("저장소 권한");
		expect(target.setItem).not.toHaveBeenCalled();
	});
});
