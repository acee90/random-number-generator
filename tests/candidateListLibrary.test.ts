import { describe, expect, it, vi } from "vitest";
import { candidateDraftLimits } from "../src/lib/candidateListDraft";
import {
	type CandidateLibrary,
	previewLibraryKey,
	readCandidateLibrary,
	writeCandidateLibrary,
} from "../stories/candidate-lists/list-library";

function library(): CandidateLibrary {
	return {
		version: 1,
		lastUsedId: "weekday",
		lists: [
			{
				id: "weekday",
				name: "평일 점심",
				updatedAt: 1_794_614_400_000,
				items: [
					{
						id: "restaurant-one",
						name: "국밥집",
						category: "한식",
						included: true,
						menu: "돼지국밥",
						distanceMeters: 0,
					},
					{
						id: "restaurant-two",
						name: "국밥집",
						category: "",
						included: false,
					},
				],
			},
		],
	};
}

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => values.set(key, value)),
	};
}

describe("Storybook candidate list library", () => {
	it("restores the last used list, excluded rows and template metadata after another visit", () => {
		const original = library();
		const storage = memoryStorage();
		writeCandidateLibrary(storage, original);
		const restored = readCandidateLibrary(storage);
		expect(restored).toEqual({ library: original, error: "" });
		expect(restored.library.lists[0]).not.toBe(original.lists[0]);
		expect(restored.library.lists[0].items[0]).not.toBe(
			original.lists[0].items[0],
		);
		original.lists[0].items[0].name = "편집 중인 초안";
		expect(readCandidateLibrary(storage).library.lists[0].items[0].name).toBe(
			"국밥집",
		);
		restored.library.lists[0].items[0].included = false;
		expect(
			readCandidateLibrary(storage).library.lists[0].items[0].included,
		).toBe(true);
	});

	it("keeps equal names as distinct candidates and permits copied template IDs in different lists", () => {
		const value = library();
		value.lists.push({
			...value.lists[0],
			id: "weekend",
			name: "주말 점심",
		});
		value.lastUsedId = "weekend";
		const storage = memoryStorage();
		writeCandidateLibrary(storage, value);
		const restored = readCandidateLibrary(storage);
		expect(restored.error).toBe("");
		expect(restored.library).toEqual(value);
		expect(restored.library.lists[0].items.map((item) => item.id)).toEqual([
			"restaurant-one",
			"restaurant-two",
		]);
	});

	it("uses only the isolated preview namespace and never reads or rewrites service data", () => {
		const initial = {
			"randomlab.history": "unchanged history",
			"jeommechu.nickname": "unchanged nickname",
			"jeommechu.room.host-proof": "unchanged proof",
		};
		const storage = memoryStorage(initial);
		writeCandidateLibrary(storage, library());
		readCandidateLibrary(storage);
		expect(storage.setItem).toHaveBeenCalledTimes(1);
		expect(storage.setItem.mock.calls[0][0]).toBe(previewLibraryKey);
		expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(previewLibraryKey);
		for (const [key, value] of Object.entries(initial)) {
			expect(storage.values.get(key)).toBe(value);
		}
	});

	it("starts with separate empty libraries when nothing is saved", () => {
		const storage = memoryStorage();
		const first = readCandidateLibrary(storage);
		const second = readCandidateLibrary(storage);
		expect(first).toEqual({
			library: { version: 1, lists: [], lastUsedId: null },
			error: "",
		});
		expect(first.library).not.toBe(second.library);
		expect(first.library.lists).not.toBe(second.library.lists);
		expect(storage.setItem).not.toHaveBeenCalled();
	});

	it.each([
		"{",
		"null",
		JSON.stringify({ ...library(), version: 2 }),
		JSON.stringify({ ...library(), lastUsedId: "missing" }),
	])("reports unreadable storage without deleting or overwriting the original: %s", (raw) => {
		const storage = memoryStorage({ [previewLibraryKey]: raw });
		const restored = readCandidateLibrary(storage);
		expect(restored.library.lists).toEqual([]);
		expect(restored.error).not.toBe("");
		expect(storage.values.get(previewLibraryKey)).toBe(raw);
		expect(storage.setItem).not.toHaveBeenCalled();
	});

	it("reports blocked reads and propagates failed writes without changing the draft", () => {
		const blocked = {
			getItem: () => {
				throw new Error("Blocked");
			},
		};
		expect(readCandidateLibrary(blocked).error).not.toBe("");
		expect(readCandidateLibrary(blocked).library.lastUsedId).toBeNull();
		const value = library();
		const before = structuredClone(value);
		const writer = {
			setItem: vi.fn(() => {
				throw new Error("Quota exceeded");
			}),
		};
		expect(() => writeCandidateLibrary(writer, value)).toThrow(
			"브라우저에 목록을 저장할 수 없어요.",
		);
		expect(value).toEqual(before);
	});

	it.each<[string, (value: CandidateLibrary) => void]>([
		[
			"duplicate list IDs",
			(value: CandidateLibrary) => value.lists.push({ ...value.lists[0] }),
		],
		[
			"duplicate item IDs",
			(value: CandidateLibrary) => {
				value.lists[0].items[1].id = value.lists[0].items[0].id;
			},
		],
		[
			"too many lists",
			(value: CandidateLibrary) => {
				value.lists = Array.from(
					{ length: candidateDraftLimits.savedLists + 1 },
					(_, n) => ({ ...value.lists[0], id: `list-${n}` }),
				);
				value.lastUsedId = null;
			},
		],
		[
			"too many rows",
			(value: CandidateLibrary) => {
				value.lists[0].items = Array.from(
					{ length: candidateDraftLimits.items + 1 },
					(_, n) => ({ ...value.lists[0].items[0], id: `row-${n}` }),
				);
			},
		],
		[
			"blank list name",
			(value: CandidateLibrary) => {
				value.lists[0].name = " ";
			},
		],
		[
			"long list name",
			(value: CandidateLibrary) => {
				value.lists[0].name = "목".repeat(candidateDraftLimits.name + 1);
			},
		],
		[
			"blank candidate",
			(value: CandidateLibrary) => {
				value.lists[0].items[0].name = " ";
			},
		],
		[
			"long candidate",
			(value: CandidateLibrary) => {
				value.lists[0].items[0].name = "목".repeat(
					candidateDraftLimits.itemName + 1,
				);
			},
		],
		[
			"long category",
			(value: CandidateLibrary) => {
				value.lists[0].items[0].category = "목".repeat(
					candidateDraftLimits.category + 1,
				);
			},
		],
		[
			"negative time",
			(value: CandidateLibrary) => {
				value.lists[0].updatedAt = -1;
			},
		],
		[
			"nonfinite time",
			(value: CandidateLibrary) => {
				value.lists[0].updatedAt = Number.NaN;
			},
		],
		[
			"negative distance",
			(value: CandidateLibrary) => {
				value.lists[0].items[0].distanceMeters = -1;
			},
		],
	])("rejects %s before writing and does not erase an existing valid library", (_, change) => {
		const storage = memoryStorage();
		writeCandidateLibrary(storage, library());
		const before = storage.values.get(previewLibraryKey);
		const invalid = library();
		change(invalid);
		expect(() => writeCandidateLibrary(storage, invalid)).toThrow();
		expect(storage.setItem).toHaveBeenCalledTimes(1);
		expect(storage.values.get(previewLibraryKey)).toBe(before);
	});
});
