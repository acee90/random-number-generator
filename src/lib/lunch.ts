export const lunchCategories = [
	"편의점",
	"카페/베이커리/패스트푸드",
	"샐러드",
	"편의점/마트",
	"한식",
	"일식",
	"분식",
	"중식",
] as const;

export type LunchCategory = (typeof lunchCategories)[number];

export interface LunchPlace {
	id: string;
	name: string;
	menu?: string;
	category: LunchCategory;
	distanceMeters?: number;
}

export const lunchSource = {
	label: "선정릉 점심 식당 목록",
	fileName: "선정릉_점심식당_목록.xlsx",
	sheetName: "식당 목록",
	cellRange: "A5:D39",
	distanceLabel: "엑셀 기준 거리",
} as const;

export const sampleLunchPlaces: readonly LunchPlace[] = [
	{
		id: "seonjeongneung-01",
		name: "세븐일레븐 선릉스타점",
		category: "편의점",
		distanceMeters: 67,
	},
	{
		id: "seonjeongneung-02",
		name: "CU 역삼목화점",
		category: "편의점",
		distanceMeters: 129,
	},
	{
		id: "seonjeongneung-03",
		name: "써브웨이(선정릉점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 152,
	},
	{
		id: "seonjeongneung-04",
		name: "세븐일레븐 강남언주로점",
		category: "편의점",
		distanceMeters: 163,
	},
	{
		id: "seonjeongneung-05",
		name: "샐러디선정릉역점",
		category: "샐러드",
		distanceMeters: 204,
	},
	{
		id: "seonjeongneung-06",
		name: "CU 선정릉역점",
		category: "편의점",
		distanceMeters: 220,
	},
	{
		id: "seonjeongneung-07",
		name: "세븐일레븐 역삼선릉로점",
		category: "편의점",
		distanceMeters: 224,
	},
	{
		id: "seonjeongneung-08",
		name: "포케올데이(선정릉점)",
		category: "샐러드",
		distanceMeters: 232,
	},
	{
		id: "seonjeongneung-09",
		name: "GS25 논현성암점",
		category: "편의점/마트",
		distanceMeters: 236,
	},
	{
		id: "seonjeongneung-10",
		name: "이태리부대찌개(선정릉점)",
		category: "한식",
		distanceMeters: 241,
	},
	{
		id: "seonjeongneung-11",
		name: "행복한김치찌개",
		category: "한식",
		distanceMeters: 250,
	},
	{
		id: "seonjeongneung-12",
		name: "봉은집(강남밥상)",
		category: "한식",
		distanceMeters: 260,
	},
	{
		id: "seonjeongneung-13",
		name: "레코드 커피 로스터스",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 261,
	},
	{
		id: "seonjeongneung-14",
		name: "언니네집밥 1호점",
		category: "한식",
		distanceMeters: 262,
	},
	{
		id: "seonjeongneung-15",
		name: "CU 논현선정릉점",
		category: "편의점",
		distanceMeters: 264,
	},
	{
		id: "seonjeongneung-16",
		name: "맑은바닷가",
		category: "일식",
		distanceMeters: 272,
	},
	{
		id: "seonjeongneung-17",
		name: "범호국수 선정릉 본점",
		category: "한식",
		distanceMeters: 278,
	},
	{
		id: "seonjeongneung-18",
		name: "매머드익스프레스 선릉로사거리점",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 288,
	},
	{
		id: "seonjeongneung-19",
		name: "찌개집1979 삼성점",
		category: "한식",
		distanceMeters: 308,
	},
	{
		id: "seonjeongneung-20",
		name: "홍스나나",
		category: "한식",
		distanceMeters: 312,
	},
	{
		id: "seonjeongneung-21",
		name: "세븐일레븐 삼성플러스원점",
		category: "편의점",
		distanceMeters: 315,
	},
	{
		id: "seonjeongneung-22",
		name: "수락정김밥",
		category: "분식",
		distanceMeters: 317,
	},
	{
		id: "seonjeongneung-23",
		name: "리드커피스탠드",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 321,
	},
	{
		id: "seonjeongneung-24",
		name: "청담골반상",
		category: "한식",
		distanceMeters: 325,
	},
	{
		id: "seonjeongneung-25",
		name: "세븐일레븐 역삼우일점",
		category: "편의점",
		distanceMeters: 335,
	},
	{
		id: "seonjeongneung-26",
		name: "맥도날드(강남삼성DT점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 357,
	},
	{
		id: "seonjeongneung-27",
		name: "육전국밥 선정릉점",
		category: "한식",
		distanceMeters: 362,
	},
	{
		id: "seonjeongneung-28",
		name: "카페담",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 377,
	},
	{
		id: "seonjeongneung-29",
		name: "리향(논현점)",
		category: "중식",
		distanceMeters: 392,
	},
	{
		id: "seonjeongneung-30",
		name: "해마루도시락(논현점)",
		category: "한식",
		distanceMeters: 392,
	},
	{
		id: "seonjeongneung-31",
		name: "입e편한집",
		category: "한식",
		distanceMeters: 396,
	},
	{
		id: "seonjeongneung-32",
		name: "3일소고기국밥",
		category: "한식",
		distanceMeters: 403,
	},
	{
		id: "seonjeongneung-33",
		name: "시베리안 빙수킹 카페",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 409,
	},
	{
		id: "seonjeongneung-34",
		name: "우리할매떡볶이 선릉점",
		category: "분식",
		distanceMeters: 411,
	},
	{
		id: "seonjeongneung-35",
		name: "마이니치 라멘 (선정릉점)",
		category: "일식",
		distanceMeters: 420,
	},
];

function validateIndex(index: number, count: number): void {
	if (!Number.isSafeInteger(count) || count < 1) {
		throw new RangeError("추첨 후보 수를 확인해 주세요.");
	}
	if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
		throw new RangeError("추첨 결과가 후보 범위를 벗어났습니다.");
	}
}

export function resolveLunchWinner(
	candidates: readonly LunchPlace[],
	resultIndex: number,
): LunchPlace {
	validateIndex(resultIndex, candidates.length);
	const winner = candidates[resultIndex];
	if (!winner) throw new RangeError("추첨 후보를 확인해 주세요.");
	return winner;
}

export function getWheelRotation(
	previousRotation: number,
	winnerIndex: number,
	count: number,
): number {
	validateIndex(winnerIndex, count);
	if (!Number.isFinite(previousRotation) || previousRotation < 0) {
		throw new RangeError("룰렛 회전값을 확인해 주세요.");
	}
	const winnerCenter = ((winnerIndex + 0.5) * 360) / count;
	const target = (360 - winnerCenter) % 360;
	const correction = (target - (previousRotation % 360) + 360) % 360;
	const rotation = previousRotation + 4 * 360 + correction;
	if (!Number.isFinite(rotation) || rotation - previousRotation < 4 * 360) {
		throw new RangeError("룰렛 회전값이 너무 큽니다.");
	}
	return rotation;
}
