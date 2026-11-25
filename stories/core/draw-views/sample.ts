import type { DrawView } from "@/lib/drawView";
import type { LunchPlace } from "@/lib/lunch";
import {
	getRoomDrawDuration,
	getRoomDrawRotation,
	type RoomDraw,
} from "@/lib/lunchRoom";
import {
	changeSpinDrive,
	getSpinLanding,
	startSpinDrive,
} from "@/lib/spinDrive";

const menus = [
	["숯불 돼지불백", "한식"],
	["얼큰 순두부찌개", "한식"],
	["소고기 쌀국수", "아시안"],
	["통새우 버거", "양식"],
	["김치 볶음밥", "한식"],
	["가지 덮밥", "중식"],
	["토마토 파스타", "양식"],
	["수제 등심 돈가스", "일식"],
	["청국장 정식", "한식"],
	["매운 마제소바", "일식"],
	["연어 포케", "샐러드"],
	["제육 쌈밥", "한식"],
	["매콤 닭갈비", "한식"],
	["들기름 막국수", "한식"],
	["바지락 칼국수", "한식"],
	["탄탄멘", "일식"],
	["해산물 리소토", "양식"],
	["명란 크림 우동", "일식"],
	["나물 비빔밥", "한식"],
	["새우 완탕면", "중식"],
] as const;
const kitchens = [
	"",
	"온기",
	"소담",
	"봄날",
	"다온",
	"소반",
	"담소",
	"늘봄",
	"마루",
	"한결",
];

export function sampleCandidates(
	count: number,
	longName: boolean,
): LunchPlace[] {
	return Array.from({ length: count }, (_, i) => {
		const [menu, category] = menus[i % menus.length];
		const kitchen = kitchens[Math.floor(i / menus.length)];
		const name = kitchen ? `${kitchen}식당 · ${menu}` : menu;
		return {
			id: `menu-${i + 1}`,
			name:
				longName && i === Math.min(13, count - 1)
					? "들기름 막국수와 제철 채소를 곁들인 오늘의 점심 한 상 "
							.repeat(3)
							.slice(0, 80)
					: name,
			category,
		};
	});
}

// A fixed outcome makes the three presentations directly comparable in review.
export function sampleRound(
	candidates: LunchPlace[],
	round: number,
	longName: boolean,
	drive?: { mode: DrawView; startIndex: number },
): RoomDraw {
	const winnerIndex = Math.min(longName ? 13 : 17, candidates.length - 1);
	const startedAt = Date.now();
	return {
		id: `preview-${round}`,
		roundNumber: round,
		candidates,
		winnerIndex,
		startedAt,
		durationMs: getRoomDrawDuration(),
		timestamp: startedAt,
		source: "csprng",
		listVersion: 1,
		fromRotation: 0,
		toRotation: getRoomDrawRotation(winnerIndex, candidates.length),
		...(drive && {
			viewMode: drive.mode,
			drive: startSpinDrive(startedAt, drive.mode, drive.startIndex),
		}),
		probabilities: candidates.map(() => 1 / candidates.length),
		participants: [{ id: "preview-host", name: "방장", isHost: true }],
		votes: [],
	};
}

export function previewSpinHeld(
	draw: RoomDraw,
	held: boolean,
	at = Date.now(),
	sequence = (draw.drive?.sequence ?? 0) + 1,
): RoomDraw {
	if (!draw.drive) return draw;
	const { mode, landing, period } = getSpinLanding(draw);
	const drive = changeSpinDrive(
		draw.drive,
		held,
		sequence,
		at,
		mode,
		landing,
		period,
	);
	return drive === draw.drive ? draw : { ...draw, drive };
}
