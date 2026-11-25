import { useCallback, useEffect, useRef, useState } from "react";

export function useDrawSound(
	scope: string | null,
	audible: boolean,
	drawId: string | undefined,
	phase: "spinning" | "result" | null,
	gameMode: "wheel" | "slot-v1" = "wheel",
) {
	const [enabled, setEnabled] = useState(false);
	const [supported, setSupported] = useState(false);
	const [error, setError] = useState("");
	const contextRef = useRef<AudioContext | null>(null);
	const stopRef = useRef<(() => void) | null>(null);
	const observedDraw = useRef<string | undefined>(undefined);

	const stop = useCallback(() => {
		stopRef.current?.();
		stopRef.current = null;
		observedDraw.current = undefined;
	}, []);

	const close = useCallback(() => {
		stop();
		const context = contextRef.current;
		contextRef.current = null;
		if (context) void context.close().catch(() => {});
	}, [stop]);

	useEffect(() => {
		setEnabled(false);
		setError("");
		if (!scope) return;
		setSupported(typeof window.AudioContext === "function");
		function onVisibility() {
			if (document.hidden) stop();
		}
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			close();
		};
	}, [scope, close, stop]);

	useEffect(() => {
		if (!enabled || !audible || !drawId || document.hidden) {
			stop();
			return;
		}
		if (phase === "spinning") {
			observedDraw.current = drawId;
			return;
		}
		if (phase !== "result" || observedDraw.current !== drawId) return;
		const context = contextRef.current;
		stop();
		if (context?.state !== "running") return;

		const note = context.createOscillator();
		const gain = context.createGain();
		const start = context.currentTime;
		if (gameMode === "slot-v1") {
			note.type = "square";
			note.frequency.setValueAtTime(980, start);
			note.frequency.exponentialRampToValueAtTime(370, start + 0.045);
		} else {
			note.frequency.setValueAtTime(523.25, start);
			note.frequency.setValueAtTime(659.25, start + 0.09);
		}
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
		const duration = gameMode === "slot-v1" ? 0.055 : 0.24;
		gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
		note.connect(gain).connect(context.destination);

		function disconnect() {
			note.disconnect();
			gain.disconnect();
		}
		function silence() {
			note.stop();
			disconnect();
		}
		note.onended = () => {
			if (stopRef.current === silence) {
				disconnect();
				stopRef.current = null;
			}
		};
		stopRef.current = silence;
		note.start(start);
		note.stop(start + duration);
	}, [audible, drawId, enabled, gameMode, phase, stop]);

	function toggle() {
		setError("");
		if (contextRef.current) {
			close();
			setEnabled(false);
			return;
		}
		try {
			const context = new AudioContext();
			contextRef.current = context;
			setEnabled(true);
			void context.resume().catch(() => {
				if (contextRef.current !== context) return;
				close();
				setEnabled(false);
				setError("효과음을 켜지 못했습니다.");
			});
		} catch {
			close();
			setEnabled(false);
			setError("효과음을 켜지 못했습니다.");
		}
	}

	return { enabled, supported, error, toggle };
}
