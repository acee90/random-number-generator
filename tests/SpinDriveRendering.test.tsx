// @vitest-environment jsdom
import {
	act,
	cleanup,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	getSpinAdjustment,
	sampleDisplaySpin,
} from "@/components/features/game-art/spin-motion";
import { LunchWheel } from "@/components/features/LunchWheel";
import SlotMachine from "@/components/features/slot/SlotMachine";
import { useRoomTimeline } from "@/hooks/useRoomTimeline";
import { useSpinAdjustment } from "@/hooks/useSpinAdjustment";
import type { LunchPlace } from "@/lib/lunch";
import type { RoomDraw } from "@/lib/lunchRoom";
import {
	changeSpinDrive,
	getDefaultSpinTuning,
	getDefaultTapBoost,
	getSpinSlotIndex,
	type SpinDrive,
	sampleSpinDrive,
	startSpinDrive,
} from "@/lib/spinDrive";

const start = 1_800_000_000_000;
const candidates: LunchPlace[] = Array.from({ length: 150 }, (_, index) => ({
	id: `candidate-${index}`,
	name: `후보 메뉴 ${index + 1}`,
	category: "한식",
}));
const numbers = candidates.map((_, index) => index + 1);

function makeDraw(drive: SpinDrive): RoomDraw {
	return {
		id: "frozen-round",
		candidates,
		winnerIndex: 132,
		source: "quantum",
		timestamp: start,
		startedAt: start,
		durationMs: 7200,
		fromRotation: 0,
		toRotation: 0,
		listVersion: 1,
		drive,
	};
}

beforeEach(() => {
	vi.useFakeTimers({
		toFake: [
			"Date",
			"requestAnimationFrame",
			"cancelAnimationFrame",
			"setTimeout",
			"clearTimeout",
		],
	});
	vi.setSystemTime(start);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function advance(milliseconds: number) {
	act(() => vi.advanceTimersByTime(milliseconds));
}

it.each([
	["wheel", 0.1, 0.37, 1],
	["slot-v1", 1.91, 495, 798],
] as const)("absorbs a delayed %s release correction without a speed rebound", (mode, offset, landing, period) => {
	const held = startSpinDrive(start, mode);
	const coast = changeSpinDrive(
		held,
		false,
		1,
		start + 3000,
		mode,
		landing,
		period,
	);
	const { stopAt, target } = coast;
	if (stopAt === undefined || target === undefined)
		throw Error("Expected a release");
	const acknowledgedAt = coast.at + 495;
	const canonical = sampleSpinDrive(coast, acknowledgedAt, mode);
	const before = { ...canonical, position: canonical.position - offset };
	const cycle = mode === "wheel" ? 1 : 0;
	expect(
		getSpinAdjustment(coast, acknowledgedAt, mode, canonical, cycle),
	).toBeUndefined();
	const adjustment = getSpinAdjustment(
		coast,
		acknowledgedAt,
		mode,
		before,
		cycle,
	);
	const sample = (at: number) => sampleDisplaySpin(coast, at, mode, adjustment);
	expect(adjustment?.kind).toBe("coast");
	expect(sample(acknowledgedAt)).toEqual(before);
	for (let at = acknowledgedAt + 16; at < stopAt; at += 16) {
		const current = sample(at);
		const previous = sample(at - 16);
		expect(current.position).toBeGreaterThan(previous.position);
		expect(current.speed).toBeLessThan(previous.speed);
		expect(current.speed).toBeGreaterThan(0);
	}
	const sampleTime = acknowledgedAt + 200;
	const derivative =
		(sample(sampleTime + 1).position - sample(sampleTime - 1).position) * 500;
	expect(sample(sampleTime).speed).toBeCloseTo(derivative, 4);
	expect(sample(sampleTime).speed).toBeLessThan(before.speed * 0.94);
	expect(sample(stopAt)).toEqual({ position: target, speed: 0 });
	if (mode === "slot-v1")
		expect(getSpinSlotIndex(sample(stopAt).position, period, coast)).toBe(
			landing,
		);
});

it("carries the displayed motion through a server acknowledgement and regrip", () => {
	const mode = "wheel";
	const releasedAt = start + 3200;
	const optimistic = changeSpinDrive(
		startSpinDrive(start, mode),
		false,
		1,
		releasedAt,
		mode,
		0,
		1,
	);
	const authoritative = changeSpinDrive(
		startSpinDrive(start + 85, mode),
		false,
		1,
		releasedAt + 140,
		mode,
		0.42,
		1,
	);
	const receivedAt = releasedAt + 495;
	vi.setSystemTime(receivedAt);
	const view = renderHook(
		({ drive, clockOffset }) =>
			useSpinAdjustment("same-round", drive, mode, clockOffset, 8),
		{ initialProps: { drive: optimistic, clockOffset: 0 } },
	);
	const before = sampleDisplaySpin(
		optimistic,
		receivedAt,
		mode,
		view.result.current,
	);
	const clockOffset = 25;
	view.rerender({ drive: authoritative, clockOffset });
	const settled = view.result.current;
	expect(settled?.kind).toBe("coast");
	expect(
		sampleDisplaySpin(authoritative, receivedAt + clockOffset, mode, settled),
	).toEqual(before);
	view.rerender({ drive: { ...authoritative }, clockOffset });
	expect(view.result.current).toBe(settled);

	const regripAt = receivedAt + 850;
	const beforeRegrip = sampleDisplaySpin(
		authoritative,
		regripAt + clockOffset,
		mode,
		settled,
	);
	const regrip = changeSpinDrive(
		authoritative,
		true,
		2,
		regripAt + 18,
		mode,
		0.42,
		1,
	);
	vi.setSystemTime(regripAt);
	view.rerender({ drive: regrip, clockOffset });
	expect(
		sampleDisplaySpin(
			regrip,
			regripAt + clockOffset,
			mode,
			view.result.current,
		),
	).toEqual({
		position: beforeRegrip.position,
		speed: Math.min(
			getDefaultSpinTuning(mode).maxSpeed,
			beforeRegrip.speed + getDefaultTapBoost(mode),
		),
	});
	expect(
		sampleDisplaySpin(
			regrip,
			regripAt + clockOffset + 250,
			mode,
			view.result.current,
		).speed,
	).toBeGreaterThan(beforeRegrip.speed);
	expect(
		sampleDisplaySpin(
			regrip,
			regripAt + clockOffset + 4000,
			mode,
			view.result.current,
		).speed,
	).toBe(5);
});

it.each([
	"wheel",
	"slot-v1",
] as const)("shows a fast tap in %s immediately and preserves speed when it is acknowledged", (mode) => {
	const [landing, period] = mode === "wheel" ? [0.65, 1] : [38, 150];
	const held = startSpinDrive(start, mode);
	const coast = changeSpinDrive(
		held,
		false,
		1,
		start + 60,
		mode,
		landing,
		period,
	);
	const pressedAt = start + 100;
	vi.setSystemTime(pressedAt);
	const view = renderHook(
		({ drive }) => useSpinAdjustment("same-round", drive, mode, 0, period),
		{
			initialProps: { drive: coast },
		},
	);
	const before = sampleDisplaySpin(coast, pressedAt, mode, view.result.current);
	const optimistic = changeSpinDrive(
		coast,
		true,
		2,
		pressedAt,
		mode,
		landing,
		period,
	);
	view.rerender({ drive: optimistic });
	const boosted = sampleDisplaySpin(
		optimistic,
		pressedAt,
		mode,
		view.result.current,
	);
	expect(boosted.position).toBe(before.position);
	expect(boosted.speed).toBeCloseTo(before.speed + getDefaultTapBoost(mode));
	const receivedAt = pressedAt + 80;
	vi.setSystemTime(receivedAt);
	const beforeAck = sampleDisplaySpin(
		optimistic,
		receivedAt,
		mode,
		view.result.current,
	);
	const ack = changeSpinDrive(
		coast,
		true,
		2,
		pressedAt + 50,
		mode,
		landing,
		period,
	);
	view.rerender({ drive: ack });
	expect(sampleDisplaySpin(ack, receivedAt, mode, view.result.current)).toEqual(
		beforeAck,
	);
	const released = changeSpinDrive(
		optimistic,
		false,
		3,
		receivedAt,
		mode,
		landing,
		period,
	);
	view.rerender({ drive: released });
	const sample = (at: number) =>
		sampleDisplaySpin(released, at, mode, view.result.current);
	expect(sample(receivedAt)).toEqual(beforeAck);
	expect(sample(receivedAt + 100).speed).toBeLessThan(beforeAck.speed);
});

it("keeps the wheel's forward path when an equivalent target is already behind", () => {
	const drive = changeSpinDrive(
		startSpinDrive(start, "wheel"),
		false,
		1,
		start + 3000,
		"wheel",
		0.71,
		1,
	);
	const { stopAt, target } = drive;
	if (stopAt === undefined || target === undefined)
		throw Error("Expected a release");
	const at = stopAt - 800;
	const before = { position: target + 0.03, speed: 1.7 };
	const adjustment = getSpinAdjustment(drive, at, "wheel", before, 1);
	expect(adjustment?.kind).toBe("coast");
	expect(sampleDisplaySpin(drive, at, "wheel", adjustment)).toEqual(before);
	expect(
		sampleDisplaySpin(drive, at + 100, "wheel", adjustment).position,
	).toBeGreaterThan(before.position);
	expect(sampleDisplaySpin(drive, stopAt, "wheel", adjustment)).toEqual({
		position: target + 1,
		speed: 0,
	});
});

it("settles a late correction through its exact nearby target", () => {
	const drive = changeSpinDrive(
		startSpinDrive(start, "wheel"),
		false,
		1,
		start + 3000,
		"wheel",
		0.71,
		1,
	);
	const { stopAt, target } = drive;
	if (stopAt === undefined || target === undefined)
		throw Error("Expected a release");
	const at = stopAt - 100;
	const before = { position: target + 0.02, speed: 0.05 };
	const adjustment = getSpinAdjustment(drive, at, "wheel", before, 1);
	expect(adjustment?.kind).toBe("coast");
	expect(sampleDisplaySpin(drive, at, "wheel", adjustment)).toEqual(before);
	const derivative =
		(sampleDisplaySpin(drive, at + 50.01, "wheel", adjustment).position -
			sampleDisplaySpin(drive, at + 49.99, "wheel", adjustment).position) *
		50_000;
	expect(
		sampleDisplaySpin(drive, at + 50, "wheel", adjustment).speed,
	).toBeCloseTo(derivative, 2);
	expect(sampleDisplaySpin(drive, stopAt, "wheel", adjustment)).toEqual({
		position: target,
		speed: 0,
	});
});

it("reports the actual velocity of a legacy position correction", () => {
	const drive: SpinDrive = {
		held: true,
		at: start,
		position: 0,
		speed: 0.95,
		sequence: 0,
	};
	const at = start + 500;
	const canonical = sampleSpinDrive(drive, at, "wheel");
	const before = {
		position: canonical.position + 0.1,
		speed: canonical.speed - 0.2,
	};
	const adjustment = getSpinAdjustment(drive, at, "wheel", before, 1);
	const sample = (ms: number) =>
		sampleDisplaySpin(drive, at + ms, "wheel", adjustment);
	expect(sample(0).position).toBeCloseTo(before.position);
	expect(sample(0).speed).toBeCloseTo(before.speed);
	const derivative = (sample(251).position - sample(249).position) * 500;
	expect(sample(250).speed).toBeCloseTo(derivative, 4);
	expect(sample(550)).toEqual(sampleSpinDrive(drive, at + 550, "wheel"));
});

it("rotates the native wheel before a result arrives and keeps moving after a regrip", () => {
	const rotorRef = createRef<HTMLDivElement>();
	const props: ComponentProps<typeof LunchWheel> = {
		candidates: candidates.slice(0, 8),
		candidateNumbers: numbers.slice(0, 8),
		rotation: 0,
		phase: "spinning",
		onComplete: vi.fn(),
		onDraw: vi.fn(),
		buttonId: "start",
		buttonRef: createRef(),
		covered: false,
		rotorRef,
	};
	const held = startSpinDrive(start, "wheel");
	const view = render(<LunchWheel {...props} drive={held} />);
	const angle = () =>
		Number.parseFloat(rotorRef.current?.style.transform.slice(7) ?? "");
	advance(16);
	expect(angle()).toBeGreaterThan(0);
	expect(angle()).toBeLessThan(12);
	advance(384);
	expect(angle()).toBeGreaterThan(100);
	const braking = changeSpinDrive(held, false, 1, Date.now(), "wheel", 0.25, 1);
	const released = angle();
	view.rerender(<LunchWheel {...props} drive={braking} />);
	expect(angle()).toBe(released);
	advance(700);
	expect(angle()).toBeGreaterThan(released);
	const regrip = changeSpinDrive(
		braking,
		true,
		2,
		Date.now(),
		"wheel",
		0.25,
		1,
	);
	const precedingFrame = angle();
	view.rerender(<LunchWheel {...props} drive={regrip} />);
	expect(angle() - precedingFrame).toBeLessThan(12);
	advance(500);
	expect(angle()).toBeGreaterThan(precedingFrame + 120);
	const finalBrake = changeSpinDrive(
		regrip,
		false,
		3,
		Date.now(),
		"wheel",
		0.25,
		1,
	);
	view.rerender(<LunchWheel {...props} drive={finalBrake} />);
	advance((finalBrake.stopAt ?? 0) - Date.now() + 32);
	expect(angle() % 360).toBeCloseTo(90);
});

it("runs only four physical slot rows from the first candidate and lands on the frozen winner", () => {
	const props: ComponentProps<typeof SlotMachine> = {
		candidates,
		numbers,
		clockOffset: 0,
		draw: null,
		phase: "idle",
		reduced: false,
		host: true,
		disabled: false,
		result: null,
		showVoting: false,
		children: <div />,
		buttonRef: createRef(),
		buttonId: "start",
		titleId: "winner",
	};
	const view = render(<SlotMachine {...props} />);
	const names = () =>
		Array.from(
			view.container.querySelectorAll(".slot-name"),
			(el) => el.textContent,
		);
	expect(screen.getAllByRole("button")).toHaveLength(1);
	expect(screen.getByRole("button", { name: "슬롯 돌리기" })).toBeTruthy();
	expect(names()[1]).toBe(candidates[0].name);
	const held = startSpinDrive(start, "slot-v1");
	view.rerender(<SlotMachine {...props} phase="spinning" drive={held} />);
	advance(16);
	expect(names()).toHaveLength(4);
	expect(names()[1]).toBe(candidates[0].name);
	advance(500);
	expect(names()).toHaveLength(4);
	expect(names()[1]).not.toBe(candidates[0].name);
	const braking = changeSpinDrive(
		held,
		false,
		1,
		Date.now(),
		"slot-v1",
		132,
		candidates.length,
	);
	const draw = makeDraw(braking);
	view.rerender(<SlotMachine {...props} phase="spinning" draw={draw} />);
	advance((braking.stopAt ?? 0) - Date.now() + 32);
	expect(names()[1]).toBe(candidates[132].name);
	view.rerender(<SlotMachine {...props} phase="done" draw={draw} />);
	expect(
		screen.getByRole("heading", { name: candidates[132].name }),
	).toBeTruthy();
});

it("keeps the same round open while held and only reveals at the latest brake deadline", () => {
	const rotor = createRef<HTMLDivElement>();
	const held = startSpinDrive(start, "wheel");
	const view = renderHook(
		({ drive }) => useRoomTimeline(makeDraw(drive), 0, rotor, true),
		{
			initialProps: { drive: held },
		},
	);
	advance(10_000);
	expect(view.result.current).toBe(false);
	const braking = changeSpinDrive(held, false, 1, Date.now(), "wheel", 0.5, 1);
	view.rerender({ drive: braking });
	advance(100);
	const regrip = changeSpinDrive(braking, true, 2, Date.now(), "wheel", 0.5, 1);
	view.rerender({ drive: regrip });
	advance(10_000);
	expect(view.result.current).toBe(false);
	const finalBrake = changeSpinDrive(
		regrip,
		false,
		3,
		Date.now(),
		"wheel",
		0.5,
		1,
	);
	view.rerender({ drive: finalBrake });
	advance((finalBrake.stopAt ?? 0) - Date.now() - 1);
	expect(view.result.current).toBe(false);
	advance(1);
	expect(view.result.current).toBe(true);
});
