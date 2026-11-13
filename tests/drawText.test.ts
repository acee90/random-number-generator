import { afterEach, describe, expect, it, vi } from "vitest";
import { createDrawText } from "../src/lib/drawText";

afterEach(() => vi.useRealTimers());

describe("draw text files", () => {
	it("uses the original Seoul creation date in both content and filename", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2030-06-15T12:00:00Z"));
		const file = createDrawText(
			{
				kind: "lotto",
				timestamp: Date.parse("2026-12-31T15:00:03Z"),
				rows: [
					{ numbers: [1, 7, 21, 28, 34, 45] },
					{ numbers: [7, 11, 21, 32, 40, 42] },
				],
			},
			{
				sourceLabel: "ANU Quantum (양자 난수)",
				strategy: "번호 고정: 7, 21 · 나머지 번호 분산 · 제외: 3, 9",
			},
		);
		expect(file.filename).toBe("jeommechu-lotto-20270101-000003.txt");
		expect(file.text).toContain("생성 시각: 2027-01-01 00:00:03 (Asia/Seoul)");
		expect(file.text).toContain("난수 출처: ANU Quantum (양자 난수)");
		expect(file.text).toContain(
			"추첨 방식: 번호 고정: 7, 21 · 나머지 번호 분산 · 제외: 3, 9",
		);
		expect(file.text).toContain(
			"1게임: 1, 7, 21, 28, 34, 45\n2게임: 7, 11, 21, 32, 40, 42",
		);
		expect(file.text).not.toContain("2030");
	});

	it("preserves all six pension digits and each ticket's group", () => {
		const file = createDrawText(
			{
				kind: "pension",
				timestamp: Date.parse("2026-11-11T00:01:02Z"),
				rows: [
					{ group: 1, numbers: [0, 0, 0, 1, 2, 3] },
					{ group: 5, numbers: [0, 9, 8, 7, 6, 5] },
				],
			},
			{ sourceLabel: "Random.org (대기 노이즈)" },
		);
		expect(file.text).toContain("점메추 · 연금복권 720+");
		expect(file.text).toContain("1게임: 1조 000123\n2게임: 5조 098765");
		expect(file.filename).toBe("jeommechu-pension-20261111-090102.txt");
		expect(file.text).not.toContain("추첨 방식:");
	});

	it("keeps negative and large integer results plain without inventing range settings", () => {
		const file = createDrawText(
			{
				kind: "number",
				timestamp: Date.parse("2026-11-11T05:06:07Z"),
				rows: [{ numbers: [-9_007_199_254_740_991, 0, 9_007_199_254_740_991] }],
			},
			{ sourceLabel: "Web Crypto (CSPRNG)" },
		);
		expect(file.text).toContain("점메추 · 랜덤 숫자");
		expect(file.text).toContain(
			"1. -9007199254740991\n2. 0\n3. 9007199254740991",
		);
		expect(file.text).not.toMatch(/최소값|최대값|추첨 방식/);
		expect(file.filename).toBe("jeommechu-number-20261111-140607.txt");
	});
});
