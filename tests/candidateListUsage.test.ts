import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateLibraryKey } from "../src/lib/candidateLibrary";
import {
	candidateListUsageKey,
	defaultCandidateListSourceId,
	readCandidateListUsage,
	recordCandidateListUse,
	savedCandidateListSourceId,
} from "../src/lib/candidateListUsage";

function storage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => values.set(key, value)),
	};
}

afterEach(() => vi.restoreAllMocks());

describe("candidate list import history", () => {
	it("preserves per-source dates and the last import without changing saved lists", () => {
		const target = storage({ [candidateLibraryKey]: "saved originals" });
		const time = vi.spyOn(Date, "now").mockReturnValue(1000);
		const savedId = savedCandidateListSourceId("team");
		expect(recordCandidateListUse(savedId, target)).toBe(true);
		time.mockReturnValue(2000);
		expect(recordCandidateListUse(defaultCandidateListSourceId, target)).toBe(
			true,
		);
		expect(readCandidateListUsage(target)).toEqual({
			recentId: defaultCandidateListSourceId,
			loadedAt: { [savedId]: 1000, [defaultCandidateListSourceId]: 2000 },
		});
		expect(target.values.get(candidateLibraryKey)).toBe("saved originals");
		expect(
			target.setItem.mock.calls.every(([key]) => key === candidateListUsageKey),
		).toBe(true);
	});

	it("keeps the newest source when pruning even if all import timestamps are equal", () => {
		vi.spyOn(Date, "now").mockReturnValue(1000);
		const target = storage();
		for (let index = 0; index < 110; index++) {
			expect(
				recordCandidateListUse(
					savedCandidateListSourceId(String(index)),
					target,
				),
			).toBe(true);
		}
		const usage = readCandidateListUsage(target);
		expect(Object.keys(usage.loadedAt)).toHaveLength(100);
		expect(usage.recentId).toBe("saved:109");
		expect(usage.loadedAt["saved:109"]).toBe(1000);
	});

	it.each([
		"{",
		'{"version":2}',
		'{"version":1,"recentId":"saved:a","loadedAt":{"saved:a":-1}}',
	])("preserves unreadable history instead of replacing it: %s", (raw) => {
		const target = storage({ [candidateListUsageKey]: raw });
		expect(readCandidateListUsage(target)).toEqual({
			recentId: null,
			loadedAt: {},
		});
		expect(recordCandidateListUse(defaultCandidateListSourceId, target)).toBe(
			false,
		);
		expect(target.values.get(candidateListUsageKey)).toBe(raw);
		expect(target.setItem).not.toHaveBeenCalled();
	});

	it("fails harmlessly when history storage is blocked", () => {
		const target = storage();
		target.getItem.mockImplementationOnce(() => {
			throw new Error("blocked");
		});
		expect(recordCandidateListUse(defaultCandidateListSourceId, target)).toBe(
			false,
		);
		target.setItem.mockImplementationOnce(() => {
			throw new Error("full");
		});
		expect(recordCandidateListUse(defaultCandidateListSourceId, target)).toBe(
			false,
		);
		expect(target.values.size).toBe(0);
	});
});
