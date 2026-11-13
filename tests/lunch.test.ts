import { describe, expect, it } from "vitest";
import {
	getWheelRotation,
	lunchCategories,
	lunchSource,
	resolveLunchWinner,
	sampleLunchPlaces,
} from "../src/lib/lunch";

function indexAtPointer(rotation: number, count: number) {
	const angleUnderPointer = ((-rotation % 360) + 360) % 360;
	return Math.floor(angleUnderPointer / (360 / count));
}

describe("provided lunch restaurant list", () => {
	it("preserves all 107 workbook rows in their original order without fabricated menus", () => {
		expect(sampleLunchPlaces).toHaveLength(107);
		expect(new Set(sampleLunchPlaces.map((place) => place.id)).size).toBe(107);
		expect(sampleLunchPlaces[0]).toEqual({
			id: "seonjeongneung-01",
			name: "세븐일레븐 선릉스타점",
			category: "편의점",
			distanceMeters: 67,
		});
		expect(sampleLunchPlaces.at(-1)).toEqual({
			id: "company-nearby-107",
			name: "구영회참치&초밥 강남점",
			category: "일식",
		});
		expect(sampleLunchPlaces.every((place) => place.menu === undefined)).toBe(
			true,
		);
	});

	it("keeps convenience stores, cafes and exact original category labels", () => {
		expect(lunchCategories).toHaveLength(11);
		expect(
			Object.fromEntries(
				lunchCategories.map((category) => [
					category,
					sampleLunchPlaces.filter((place) => place.category === category)
						.length,
				]),
			),
		).toEqual({
			한식: 44,
			편의점: 11,
			"카페/베이커리/패스트푸드": 20,
			샐러드: 3,
			일식: 8,
			분식: 2,
			"편의점/마트": 3,
			중식: 5,
			양식: 6,
			아시안푸드: 3,
			"확인 불가": 2,
		});
		expect(
			sampleLunchPlaces.every(
				(place) =>
					lunchCategories.includes(place.category) &&
					(place.distanceMeters === undefined ||
						(Number.isInteger(place.distanceMeters) &&
							place.distanceMeters > 0)),
			),
		).toBe(true);
	});

	it("identifies the provided worksheet and labels distances as spreadsheet values", () => {
		expect(lunchSource).toEqual({
			label: "회사 주변 음식점 목록",
			fileName: "회사주변_음식점_목록.xlsx",
			sheetName: "회사 주변 음식점",
			cellRange: "A6:C112",
			distanceLabel: "엑셀 기준 거리",
		});
	});

	it("keeps the workbook's unknown distance missing and retains branch distinctions", () => {
		expect(
			sampleLunchPlaces
				.filter((place) => place.distanceMeters === undefined)
				.map((place) => place.name),
		).toEqual(["구영회참치&초밥 강남점"]);
		expect(
			sampleLunchPlaces
				.filter((place) => place.category === "확인 불가")
				.map((place) => place.name),
		).toEqual(["돈웍", "언제나커피(서울삼성점)"]);
		expect(sampleLunchPlaces.some((place) => place.name === "고향집")).toBe(
			true,
		);
		expect(
			sampleLunchPlaces.some((place) => place.name === "고향집(르네상스)"),
		).toBe(true);
		const knownDistances = sampleLunchPlaces.flatMap((place) =>
			place.distanceMeters === undefined ? [] : [place.distanceMeters],
		);
		expect(knownDistances).toEqual(
			[...knownDistances].sort((left, right) => left - right),
		);
	});
});

describe("lunch draw result mapping", () => {
	it("maps the returned index to the exact filtered draw snapshot", () => {
		const candidates = [sampleLunchPlaces[8], sampleLunchPlaces[3]];
		expect(resolveLunchWinner(candidates, 0)).toBe(sampleLunchPlaces[8]);
		expect(resolveLunchWinner(candidates, 1)).toBe(sampleLunchPlaces[3]);
		expect(candidates).toEqual([sampleLunchPlaces[8], sampleLunchPlaces[3]]);
	});

	it("accepts the only candidate without changing its identity", () => {
		const last = sampleLunchPlaces[sampleLunchPlaces.length - 1];
		expect(resolveLunchWinner([last], 0)).toBe(last);
	});

	it("also accepts a future custom place without a menu or measured distance", () => {
		const custom = {
			id: "custom-1",
			name: "직접 입력 식당",
			category: "한식" as const,
		};
		expect(resolveLunchWinner([custom], 0)).toBe(custom);
	});

	it.each([
		-1,
		2,
		0.5,
		NaN,
		Infinity,
		-Infinity,
	])("rejects a server index outside the candidate snapshot: %s", (index) => {
		expect(() =>
			resolveLunchWinner(sampleLunchPlaces.slice(0, 2), index),
		).toThrow(RangeError);
	});

	it("rejects an empty or missing candidate instead of displaying another item", () => {
		expect(() => resolveLunchWinner([], 0)).toThrow(RangeError);
		expect(() => resolveLunchWinner(Array(2), 1)).toThrow(RangeError);
	});
});

describe("lunch wheel alignment", () => {
	it.each(
		Array.from({ length: sampleLunchPlaces.length }, (_, index) => index + 1),
	)("places every winner under the pointer with %i candidate(s)", (count) => {
		for (let winner = 0; winner < count; winner++) {
			for (const previous of [0, 0.5, 359.75, 720, 1800.2]) {
				const rotation = getWheelRotation(previous, winner, count);
				expect(rotation - previous).toBeGreaterThanOrEqual(1440);
				expect(rotation - previous).toBeLessThan(1800);
				expect(indexAtPointer(rotation, count)).toBe(winner);
				const pointerAngle = ((-rotation % 360) + 360) % 360;
				expect(pointerAngle / (360 / count) - winner).toBeCloseTo(0.5, 8);
			}
		}
	});

	it("stays clockwise and aligned across repeated winners and list sizes", () => {
		let rotation = 357.25;
		const fullCount = sampleLunchPlaces.length;
		for (const [count, winner] of [
			[fullCount, 0],
			[fullCount, fullCount - 1],
			[fullCount, fullCount - 1],
			[3, 1],
			[1, 0],
			[7, 6],
			[fullCount, 4],
		]) {
			const next = getWheelRotation(rotation, winner, count);
			expect(next - rotation).toBeGreaterThanOrEqual(1440);
			expect(indexAtPointer(next, count)).toBe(winner);
			rotation = next;
		}
	});

	it.each([
		0,
		-1,
		1.5,
		NaN,
		Infinity,
	])("rejects an invalid candidate count: %s", (count) => {
		expect(() => getWheelRotation(0, 0, count)).toThrow(RangeError);
	});

	it.each([
		-1,
		sampleLunchPlaces.length,
		0.5,
		NaN,
		Infinity,
	])("rejects an invalid winner index: %s", (winner) => {
		expect(() => getWheelRotation(0, winner, sampleLunchPlaces.length)).toThrow(
			RangeError,
		);
	});

	it.each([
		-1,
		NaN,
		Infinity,
		-Infinity,
		Number.MAX_VALUE,
	])("rejects an unusable previous angle: %s", (previous) => {
		expect(() =>
			getWheelRotation(previous, 0, sampleLunchPlaces.length),
		).toThrow(RangeError);
	});
});
