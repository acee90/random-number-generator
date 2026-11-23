// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LunchWheel } from "../src/components/features/LunchWheel";
import { wheelFaceRadius } from "../src/components/features/picnic/layout";
import type { LunchPlace } from "../src/lib/lunch";
import { sampleLunchPlaces } from "../src/lib/lunch";

type WheelProps = ComponentProps<typeof LunchWheel>;
function wheelProps(size = 2, overrides: Partial<WheelProps> = {}): WheelProps {
	return {
		candidates: sampleLunchPlaces.slice(0, size),
		candidateNumbers: sampleLunchPlaces
			.slice(0, size)
			.map((_, index) => index + 1),
		rotation: 0,
		phase: "idle",
		onComplete: vi.fn(),
		onDraw: vi.fn(),
		buttonId: "test-wheel-button",
		buttonRef: createRef(),
		covered: false,
		...overrides,
	};
}
function firstLabel(container: HTMLElement) {
	return Array.from(
		container.querySelectorAll(".lunch-wheel-label:first-child text"),
		(node) => node.textContent,
	);
}
function transitionCompleted(element: Element) {
	const event = new Event("transitionend", { bubbles: true });
	Object.defineProperty(event, "propertyName", { value: "transform" });
	fireEvent(element, event);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("static wheel face rendering", () => {
	it.each([
		["김치찌🍜개", "김치찌🍜개"],
		["김치찌🍜개맛집", "김치찌🍜…"],
		["🍜🍙🥟🍛🍲", "🍜🍙🥟🍛🍲"],
		["김치찌개전문점", "김치찌개…"],
	])("keeps Unicode characters intact in the label for %s", (name, label) => {
		const view = render(
			<LunchWheel
				{...wheelProps(1, {
					candidates: [{ id: "unicode", name, category: "한식" }],
					candidateNumbers: [1],
				})}
			/>,
		);
		expect(firstLabel(view.container)).toEqual(["1", label]);
	});

	it.each([
		0, 2, 107,
	])("reuses %i labels through new arrays, rotation, phase, permission and callback changes", (size) => {
		const cos = vi.spyOn(Math, "cos");
		const initial = wheelProps(size);
		const view = render(<LunchWheel {...initial} />);
		expect(cos).toHaveBeenCalledTimes(
			view.container.querySelectorAll(".lunch-wheel-label").length,
		);
		const svg = view.container.querySelector(".lunch-wheel-rotor > svg");
		expect(svg).not.toBeNull();
		const face = svg?.outerHTML;
		cos.mockClear();
		const onDraw = vi.fn();
		const onComplete = vi.fn();
		const next = {
			...initial,
			candidates: initial.candidates.map((place) => ({ ...place })),
			candidateNumbers: [...initial.candidateNumbers],
			onDraw,
			onComplete,
			rotation: 720,
			phase: "spinning" as const,
			canDraw: false,
			controlled: true,
		};
		view.rerender(<LunchWheel {...next} />);
		expect(cos).not.toHaveBeenCalled();
		expect(svg?.outerHTML).toBe(face);
		const rotor =
			view.container.querySelector<HTMLElement>(".lunch-wheel-rotor");
		expect(rotor?.style.transform).toBe("rotate(720deg)");
		expect(rotor?.getAttribute("data-phase")).toBe("spinning");
		expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
			true,
		);
		transitionCompleted(rotor as Element);
		expect(onComplete).toHaveBeenCalledTimes(1);
		expect(initial.onComplete).not.toHaveBeenCalled();
		view.rerender(
			<LunchWheel {...next} rotation={1080} phase="idle" canDraw />,
		);
		fireEvent.click(screen.getByRole("button", { name: "점심 메뉴 추첨하기" }));
		expect(onDraw).toHaveBeenCalledTimes(1);
		expect(initial.onDraw).not.toHaveBeenCalled();
		expect(cos).not.toHaveBeenCalled();
	});

	it("updates original numbers and visible names while ignoring invisible metadata changes", () => {
		const cos = vi.spyOn(Math, "cos");
		const candidates: LunchPlace[] = [
			{ id: "first", name: "한식당", category: "한식" },
			{ id: "second", name: "중식당", category: "중식" },
		];
		const props = wheelProps(2, { candidates, candidateNumbers: [100, 107] });
		const view = render(<LunchWheel {...props} />);
		cos.mockClear();
		view.rerender(<LunchWheel {...props} candidateNumbers={[101, 107]} />);
		expect(cos).toHaveBeenCalledTimes(2);
		expect(firstLabel(view.container)).toEqual(["101", "한식당"]);
		cos.mockClear();
		const renamed = candidates.map((place, index) =>
			index === 0 ? { ...place, name: "분식당" } : place,
		);
		view.rerender(
			<LunchWheel
				{...props}
				candidates={renamed}
				candidateNumbers={[101, 107]}
			/>,
		);
		expect(cos).toHaveBeenCalledTimes(2);
		expect(firstLabel(view.container)).toEqual(["101", "분식당"]);
		cos.mockClear();
		view.rerender(
			<LunchWheel
				{...props}
				candidates={renamed.map((place) => ({
					...place,
					menu: "새 메뉴",
					distanceMeters: 123,
				}))}
				candidateNumbers={[101, 107]}
			/>,
		);
		expect(cos).not.toHaveBeenCalled();
	});

	it("compares the displayed truncated name and still sees mutations to visible contents", () => {
		const cos = vi.spyOn(Math, "cos");
		const candidates: LunchPlace[] = [
			{ id: "one", name: "가나다라마바사", category: "한식" },
		];
		const props = wheelProps(1, { candidates });
		const view = render(<LunchWheel {...props} />);
		cos.mockClear();
		candidates[0].name = "가나다라다른이름";
		view.rerender(<LunchWheel {...props} />);
		expect(cos).not.toHaveBeenCalled();
		expect(firstLabel(view.container)).toEqual(["1", "가나다라…"]);
		candidates[0].name = "새 이름";
		view.rerender(<LunchWheel {...props} />);
		expect(cos).toHaveBeenCalledTimes(1);
		expect(firstLabel(view.container)).toEqual(["1", "새 이름"]);
	});

	it("rebuilds geometry when candidates change identity, order or count", () => {
		const cos = vi.spyOn(Math, "cos");
		const props = wheelProps(2);
		const view = render(<LunchWheel {...props} />);
		cos.mockClear();
		const changedId = props.candidates.map((place, index) => ({
			...place,
			id: index === 0 ? "replacement" : place.id,
		}));
		view.rerender(<LunchWheel {...props} candidates={changedId} />);
		expect(cos).toHaveBeenCalledTimes(2);
		cos.mockClear();
		view.rerender(
			<LunchWheel
				{...props}
				candidates={[...changedId].reverse()}
				candidateNumbers={[2, 1]}
			/>,
		);
		expect(cos).toHaveBeenCalledTimes(2);
		expect(firstLabel(view.container)[0]).toBe("2");
		cos.mockClear();
		view.rerender(<LunchWheel {...wheelProps(107)} />);
		const dense = view.container.querySelectorAll(".lunch-wheel-number");
		expect(dense.length).toBeGreaterThan(0);
		expect(dense.length).toBeLessThanOrEqual(107);
		expect(cos).toHaveBeenCalledTimes(dense.length);
		expect(
			view.container
				.querySelector(".lunch-wheel")
				?.getAttribute("data-candidate-count"),
		).toBe("107");
		view.rerender(<LunchWheel {...wheelProps(0)} />);
		expect(view.container.querySelectorAll("text")).toHaveLength(0);
		expect(
			view.container.querySelector(".lunch-wheel-rotor > svg"),
		).not.toBeNull();
		view.rerender(<LunchWheel {...wheelProps(2)} />);
		expect(view.container.querySelectorAll(".lunch-wheel-number")).toHaveLength(
			2,
		);
	});

	it("puts each original number at the rim and anchors its name inward on either half", () => {
		const props = wheelProps(60, {
			candidateNumbers: [7, ...Array.from({ length: 59 }, (_, i) => 200 - i)],
		});
		const view = render(<LunchWheel {...props} wheelSide={480} />);
		const rows = view.container.querySelectorAll(".lunch-wheel-label");
		expect(rows).toHaveLength(60);
		const outerEdges: number[] = [];
		for (const [index, row] of rows.entries()) {
			const [number, name] = row.querySelectorAll("text");
			const badge = row.querySelector("rect");
			expect(number.textContent).toBe(String(props.candidateNumbers[index]));
			expect(badge).not.toBeNull();
			const halfWidth = Number(badge?.getAttribute("width")) / 2;
			const [x, y, rotation] = (
				row.getAttribute("transform")?.match(/-?[\d.]+/g) ?? []
			).map(Number);
			outerEdges.push(Math.hypot(x, y) + halfWidth);
			expect(Math.abs(rotation)).toBeLessThanOrEqual(90);
			const nameX = Number(name.getAttribute("x"));
			if (index < 30) {
				expect(name.getAttribute("text-anchor")).toBe("end");
				expect(nameX).toBeLessThan(-halfWidth);
			} else {
				expect(name.getAttribute("text-anchor")).toBe("start");
				expect(nameX).toBeGreaterThan(halfWidth);
			}
		}
		expect(Math.min(...outerEdges)).toBeGreaterThan(wheelFaceRadius * 0.9);
		expect(Math.max(...outerEdges)).toBeLessThan(wheelFaceRadius);
		expect(Math.max(...outerEdges)).toBeCloseTo(Math.min(...outerEdges), 3);
		view.rerender(<LunchWheel {...props} wheelSide={294} />);
		expect(view.container.querySelector(".lunch-wheel-label rect")).toBeNull();
		const numbers = Array.from(
			view.container.querySelectorAll(".lunch-wheel-number"),
			(node) => Number(node.textContent),
		);
		expect(numbers).toEqual(props.candidateNumbers);
	});

	it("keeps every candidate in the wheel while skipping unreadable labels above 117", () => {
		const cos = vi.spyOn(Math, "cos");
		const candidates = Array.from({ length: 797 }, (_, index) => ({
			id: `restaurant-${index}`,
			name: `음식점 ${index}`,
			category: "한식",
		}));
		const view = render(
			<LunchWheel
				{...wheelProps(0)}
				candidates={candidates}
				candidateNumbers={candidates.map((_, index) => index + 1)}
			/>,
		);
		expect(
			view.container
				.querySelector(".lunch-wheel")
				?.getAttribute("data-candidate-count"),
		).toBe("797");
		expect(view.container.querySelectorAll("text")).toHaveLength(0);
		expect(cos).not.toHaveBeenCalled();
	});
});
