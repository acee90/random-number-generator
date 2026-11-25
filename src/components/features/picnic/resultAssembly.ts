export function assemblyProgress(progress: number, start: number, end: number) {
	return Math.min(1, Math.max(0, (progress * 640 - start) / (end - start)));
}

export function assemblyPose(progress: number) {
	const lift = (1 - progress) ** 3;
	return {
		lift,
		impact: Math.sin(progress * 2 * Math.PI) * (1 - progress),
		alpha: Math.min(1, progress * 5),
	};
}
