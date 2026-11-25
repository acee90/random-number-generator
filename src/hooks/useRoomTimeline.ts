import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { rouletteSpinKeyframes } from "@/components/features/picnic/motion";
import type { RoomDraw } from "@/lib/lunchRoom";
import { getSpinDeadline } from "@/lib/spinDrive";

export function useRoomTimeline(
	draw: RoomDraw | null,
	clockOffset: number,
	rotorRef: RefObject<HTMLDivElement | null>,
	motionOff: boolean,
	localLaunch = false,
) {
	const [completed, setCompleted] = useState<{
		id: string;
		deadline: number;
	} | null>(null);
	const localStart = useRef<{ drawId: string; time: number } | null>(null);
	const drawId = draw?.id;
	const startedAt = draw?.startedAt;
	const durationMs = draw?.durationMs;
	const toRotation = draw?.toRotation;
	const spinPower = draw?.spinPower;
	const deadline = draw ? getSpinDeadline(draw) : undefined;
	const driven = Boolean(draw?.drive);
	useLayoutEffect(() => {
		if (
			!drawId ||
			startedAt === undefined ||
			durationMs === undefined ||
			toRotation === undefined ||
			deadline === undefined
		) {
			setCompleted(null);
			return;
		}
		let active = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let animation: Animation | undefined;
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const now = Date.now() + clockOffset;
		if (!driven && localLaunch && localStart.current?.drawId !== drawId)
			localStart.current = { drawId, time: Math.max(now, startedAt) };
		// The initiating host can carry their launch into the remaining clock time.
		// Guests enter at elapsed server time and every client still reveals at endsAt.
		const animationStart =
			localLaunch && localStart.current?.drawId === drawId
				? localStart.current.time
				: startedAt;
		const animationDuration = deadline - animationStart;
		function align(endsAt: number, id: string) {
			if (!active) return;
			clearTimeout(timer);
			const now = Date.now() + clockOffset;
			if (now >= endsAt) {
				if (animation) {
					animation.currentTime = animationDuration;
					animation.pause();
				}
				setCompleted((previous) =>
					previous?.id === id && previous.deadline === endsAt
						? previous
						: { id, deadline: endsAt },
				);
				return;
			}
			setCompleted(null);
			if (animation) animation.currentTime = now - animationStart;
			if (Number.isFinite(endsAt))
				timer = setTimeout(() => align(endsAt, id), Math.max(1, endsAt - now));
		}
		if (
			!driven &&
			!motionOff &&
			!media.matches &&
			typeof rotorRef.current?.animate === "function" &&
			animationDuration > 0 &&
			now < deadline
		) {
			const legacy = spinPower === undefined && durationMs === 7200;
			animation = rotorRef.current.animate(
				legacy
					? [
							{ transform: "rotate(0deg)" },
							{ transform: `rotate(${toRotation}deg)` },
						]
					: rouletteSpinKeyframes(toRotation, spinPower ?? 0),
				{
					duration: animationDuration,
					easing: legacy ? "cubic-bezier(.12,.72,.16,1)" : "linear",
					fill: "both",
				},
			);
		}
		align(deadline, drawId);
		function onVisibility() {
			if (
				document.visibilityState === "visible" &&
				deadline !== undefined &&
				drawId
			)
				align(deadline, drawId);
		}
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			active = false;
			clearTimeout(timer);
			animation?.cancel();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [
		drawId,
		startedAt,
		durationMs,
		toRotation,
		spinPower,
		deadline,
		driven,
		clockOffset,
		rotorRef,
		motionOff,
		localLaunch,
	]);
	return Boolean(
		draw && completed?.id === draw.id && completed.deadline === deadline,
	);
}
