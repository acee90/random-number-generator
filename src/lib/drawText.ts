export interface TextDraw {
	kind: "number" | "lotto" | "pension";
	timestamp: number;
	rows: { numbers: number[]; group?: number }[];
}

const toolNames = {
	number: "랜덤 숫자",
	lotto: "로또 6/45",
	pension: "연금복권 720+",
};

const creationTime = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Asia/Seoul",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});

export function createDrawText(
	draw: TextDraw,
	{ sourceLabel, strategy }: { sourceLabel: string; strategy?: string },
) {
	const parts = Object.fromEntries(
		creationTime
			.formatToParts(draw.timestamp)
			.map(({ type, value }) => [type, value]),
	);
	const date = `${parts.year}-${parts.month}-${parts.day}`;
	const time = `${parts.hour}:${parts.minute}:${parts.second}`;
	const results =
		draw.kind === "number"
			? draw.rows
					.flatMap(({ numbers }) => numbers)
					.map((number, index) => `${index + 1}. ${number}`)
			: draw.rows.map((row, index) => {
					const numbers =
						draw.kind === "pension"
							? `${row.group === undefined ? "" : `${row.group}조 `}${row.numbers.join("")}`
							: row.numbers.join(", ");
					return `${index + 1}게임: ${numbers}`;
				});
	return {
		text: [
			`점메추 · ${toolNames[draw.kind]}`,
			`생성 시각: ${date} ${time} (Asia/Seoul)`,
			`난수 출처: ${sourceLabel}`,
			...(strategy ? [`추첨 방식: ${strategy}`] : []),
			"",
			"결과",
			...results,
			"",
		].join("\n"),
		filename: `jeommechu-${draw.kind}-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}.txt`,
	};
}
