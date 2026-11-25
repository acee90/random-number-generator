export function rouletteSpinKeyframes(rotation: number, power: number) {
	const ramp = 0.068 - power * 0.025;
	const brake = 0.19 - power * 0.055;
	const coastDistance = brake - ramp / 2;
	const distance = coastDistance + (1 - brake) / 3;
	const travel = (time: number) => {
		if (time < ramp) return (time * time) / (2 * ramp);
		if (time < brake) return time - ramp / 2;
		const remaining = (1 - time) / (1 - brake);
		return distance - ((1 - brake) * remaining ** 3) / 3;
	};
	const samples = 60;
	return Array.from({ length: samples + 1 }, (_, i) => {
		const offset = i / samples;
		const angle =
			i === samples ? rotation : (rotation * travel(offset)) / distance;
		return {
			offset,
			transform: `rotate(${angle}deg)`,
		};
	});
}
