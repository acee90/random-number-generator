import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { defaultSlotMaxBlurPx } from "@/components/features/slot/motion";
import SlotMachine from "@/components/features/slot/SlotMachine";
import { useSpinInput } from "@/hooks/useSpinInput";
import type { RoomDraw } from "@/lib/lunchRoom";
import { SlotSpeedTrace } from "./SlotSpeedTrace";
import { SlotTuningControls } from "./SlotTuningControls";
import { sampleCandidates, sampleRound } from "./sample";
import {
	changeTunedSlotDrive,
	getDefaultSlotTuning,
	retuneSlotDrive,
	type SlotTuning,
	sampleTunedSlotDrive,
	startTunedSlotDrive,
	type TunedSlotDrive,
} from "./slotTuningMotion";
import "@/components/features/picnic/details.css";
import "./slot-motion-lab.css";

const candidates = sampleCandidates(20, false);
const numbers = candidates.map((_, index) => index + 1);
type Round = RoomDraw & { drive: TunedSlotDrive };

export function SlotMotionLab() {
	const [tuning, setTuning] = useState(getDefaultSlotTuning);
	const [blurPx, setBlurPx] = useState(defaultSlotMaxBlurPx);
	const [round, setRound] = useState<Round | null>(null);
	const [finishedId, setFinishedId] = useState<string>();
	const current = useRef(round);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const shortcutHeld = useRef(false);
	const buttonHeld = useRef(false);
	const finished = round !== null && round.id === finishedId;
	const motionOptions = useMemo(
		() => ({ sampleDrive: sampleTunedSlotDrive, maxBlurPx: blurPx }),
		[blurPx],
	);

	function update(next: Round) {
		current.current = next;
		setRound(next);
	}

	function grip(held: boolean) {
		const now = Date.now();
		const previous = current.current;
		if (!previous || now >= (previous.drive.stopAt ?? Infinity)) {
			if (!held) return;
			const draw = sampleRound(
				candidates,
				(previous?.roundNumber ?? 0) + 1,
				false,
			);
			update({
				...draw,
				viewMode: "slot-v1",
				drive: startTunedSlotDrive(now, previous?.winnerIndex ?? 0, tuning),
			});
			return;
		}
		const drive = changeTunedSlotDrive(
			previous.drive,
			held,
			now,
			previous.winnerIndex,
			candidates.length,
		);
		if (drive !== previous.drive) update({ ...previous, drive });
	}

	function changeTuning(next: SlotTuning) {
		setTuning(next);
		const previous = current.current;
		if (!previous) return;
		const drive = retuneSlotDrive(
			previous.drive,
			next,
			Date.now(),
			previous.winnerIndex,
			candidates.length,
		);
		if (drive !== previous.drive) update({ ...previous, drive });
	}

	const input = useSpinInput({
		enabled: true,
		onPress: () => {
			buttonHeld.current = true;
			grip(true);
			return true;
		},
		onRelease: () => {
			buttonHeld.current = false;
			if (!shortcutHeld.current) grip(false);
		},
	});
	// A held key leaves the pointer free to adjust the sliders on a running reel.
	const gripFromKeyboard = useEffectEvent(grip);
	useEffect(() => {
		function keyDown(event: KeyboardEvent) {
			if (
				event.code !== "KeyR" ||
				!event.altKey ||
				event.repeat ||
				event.ctrlKey ||
				event.metaKey ||
				shortcutHeld.current
			)
				return;
			if (
				event.target instanceof HTMLElement &&
				event.target.closest("input,textarea,[contenteditable=true]")
			)
				return;
			event.preventDefault();
			shortcutHeld.current = true;
			gripFromKeyboard(true);
		}
		function release() {
			if (!shortcutHeld.current) return;
			shortcutHeld.current = false;
			if (!buttonHeld.current) gripFromKeyboard(false);
		}
		function keyUp(event: KeyboardEvent) {
			if (event.code === "KeyR" || event.key === "Alt") release();
		}
		function visibility() {
			if (document.hidden) release();
		}
		window.addEventListener("keydown", keyDown);
		window.addEventListener("keyup", keyUp);
		window.addEventListener("blur", release);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			window.removeEventListener("keydown", keyDown);
			window.removeEventListener("keyup", keyUp);
			window.removeEventListener("blur", release);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, []);

	const stopAt = round?.drive.stopAt;
	const id = round?.id;
	useEffect(() => {
		if (stopAt === undefined || id === undefined) return;
		const timer = window.setTimeout(
			() => {
				if (current.current?.drive.stopAt === stopAt) setFinishedId(id);
			},
			Math.max(0, stopAt - Date.now()),
		);
		return () => clearTimeout(timer);
	}, [stopAt, id]);

	return (
		<main className="slot-motion-lab">
			<header className="slot-lab-heading">
				<h1>슬롯머신 회전 튜닝</h1>
				<p>
					연타하면 속도가 더해지고, 길게 누르면 계속 가속합니다. 손을 떼면
					감속합니다.
				</p>
				<p className="slot-lab-hint" id="slot-lab-hint">
					<kbd>Alt / Option + R</kbd>을 누른 채 슬라이더를 움직이면 가속 중에도
					값을 바꿀 수 있습니다.
				</p>
			</header>
			<div className="slot-lab-layout">
				<div className="slot-lab-preview">
					<div className="picnic-frame slot-lab-board">
						<SlotMachine
							candidates={candidates}
							numbers={numbers}
							draw={round}
							clockOffset={0}
							phase={finished ? "done" : round ? "spinning" : "idle"}
							reduced={false}
							host
							disabled={false}
							motionOptions={motionOptions}
							drawButtonProps={{ ...input, "aria-keyshortcuts": "Alt+R" }}
							canReplay
							buttonRef={buttonRef}
							buttonId="slot-lab-spin"
							titleId="slot-lab-winner"
							holdHintId="slot-lab-hint"
							result={null}
							showVoting={false}
							resultActions={null}
						/>
					</div>
					<SlotSpeedTrace
						key={round?.id ?? "idle"}
						drive={round?.drive}
						finished={finished}
					/>
				</div>
				<SlotTuningControls
					tuning={tuning}
					blurPx={blurPx}
					onChange={changeTuning}
					onBlurChange={setBlurPx}
					onReset={() => {
						changeTuning(getDefaultSlotTuning());
						setBlurPx(defaultSlotMaxBlurPx);
					}}
				/>
			</div>
		</main>
	);
}
