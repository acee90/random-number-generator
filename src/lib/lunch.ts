export const lunchSpinDurationMs = 4000;

export const lunchCategories = [
	"편의점",
	"카페/베이커리/패스트푸드",
	"샐러드",
	"편의점/마트",
	"한식",
	"일식",
	"분식",
	"중식",
	"양식",
	"확인 불가",
	"아시안푸드",
] as const;

export type LunchCategory = (typeof lunchCategories)[number];

/** General-purpose category suggestions without workbook anomalies. */
export const defaultCategorySuggestions = [
	"한식",
	"일식",
	"중식",
	"양식",
	"분식",
	"아시안",
	"샐러드",
	"카페/베이커리",
	"편의점",
] as const;

export interface LunchPlace {
	id: string;
	name: string;
	menu?: string;
	category: string;
	distanceMeters?: number;
}

/** Universal lunch menu preset usable anywhere without local shop names. */
export const defaultLunchMenuCandidates: readonly LunchPlace[] = [
	{ id: "lunch-menu-01", name: "김치찌개", category: "한식" },
	{ id: "lunch-menu-02", name: "제육볶음", category: "한식" },
	{ id: "lunch-menu-03", name: "된장찌개", category: "한식" },
	{ id: "lunch-menu-04", name: "국밥", category: "한식" },
	{ id: "lunch-menu-05", name: "비빔밥", category: "한식" },
	{ id: "lunch-menu-06", name: "칼국수", category: "한식" },
	{ id: "lunch-menu-07", name: "돈까스", category: "일식" },
	{ id: "lunch-menu-08", name: "라멘", category: "일식" },
	{ id: "lunch-menu-09", name: "초밥", category: "일식" },
	{ id: "lunch-menu-10", name: "짜장면", category: "중식" },
	{ id: "lunch-menu-11", name: "짬뽕", category: "중식" },
	{ id: "lunch-menu-12", name: "마라탕", category: "중식" },
	{ id: "lunch-menu-13", name: "파스타", category: "양식" },
	{ id: "lunch-menu-14", name: "햄버거", category: "양식" },
	{ id: "lunch-menu-15", name: "떡볶이", category: "분식" },
	{ id: "lunch-menu-16", name: "쌀국수", category: "아시안" },
];

/** Universal gathering activity preset for non-food draws. */
export const defaultActivityCandidates: readonly LunchPlace[] = [
	{ id: "activity-01", name: "방탈출", category: "체험" },
	{ id: "activity-02", name: "보드게임 카페", category: "실내" },
	{ id: "activity-03", name: "볼링", category: "스포츠" },
	{ id: "activity-04", name: "스크린골프", category: "스포츠" },
	{ id: "activity-05", name: "노래방", category: "실내" },
	{ id: "activity-06", name: "영화 관람", category: "문화" },
	{ id: "activity-07", name: "전시회", category: "문화" },
	{ id: "activity-08", name: "카페 투어", category: "휴식" },
	{ id: "activity-09", name: "피크닉", category: "야외" },
	{ id: "activity-10", name: "맛집 투어", category: "식사" },
];

export const lunchSource = {
	label: "회사 주변 음식점 목록",
	fileName: "회사주변_음식점_목록.xlsx",
	sheetName: "회사 주변 음식점",
	cellRange: "A6:C112",
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
		id: "company-nearby-006",
		name: "파리바게뜨(선정릉역점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 206,
	},
	{
		id: "company-nearby-007",
		name: "세븐일레븐 선정릉점",
		category: "편의점",
		distanceMeters: 211,
	},
	{
		id: "company-nearby-008",
		name: "매머드익스프레스(선정릉역1번출구점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 219,
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
		id: "company-nearby-014",
		name: "제주마을",
		category: "한식",
		distanceMeters: 243,
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
	{
		id: "company-nearby-039",
		name: "일루(한식뷔페)",
		category: "한식",
		distanceMeters: 420,
	},
	{
		id: "company-nearby-040",
		name: "칙바이칙(선릉)",
		category: "양식",
		distanceMeters: 433,
	},
	{
		id: "company-nearby-041",
		name: "오봉집(선릉점)",
		category: "한식",
		distanceMeters: 434,
	},
	{
		id: "company-nearby-042",
		name: "간장랭삼집",
		category: "한식",
		distanceMeters: 435,
	},
	{
		id: "company-nearby-043",
		name: "대왕통닭 역삼점",
		category: "한식",
		distanceMeters: 436,
	},
	{
		id: "company-nearby-044",
		name: "청운각",
		category: "중식",
		distanceMeters: 437,
	},
	{
		id: "company-nearby-045",
		name: "돈웍",
		category: "확인 불가",
		distanceMeters: 438,
	},
	{
		id: "company-nearby-046",
		name: "오또상스시",
		category: "일식",
		distanceMeters: 438,
	},
	{
		id: "company-nearby-047",
		name: "에이스크랩(강남직영점)",
		category: "아시안푸드",
		distanceMeters: 443,
	},
	{
		id: "company-nearby-048",
		name: "탄(선릉점)",
		category: "일식",
		distanceMeters: 445,
	},
	{
		id: "company-nearby-049",
		name: "선릉 해선옥",
		category: "한식",
		distanceMeters: 446,
	},
	{
		id: "company-nearby-050",
		name: "금용",
		category: "중식",
		distanceMeters: 448,
	},
	{
		id: "company-nearby-051",
		name: "병천순대(선릉점)",
		category: "한식",
		distanceMeters: 449,
	},
	{
		id: "company-nearby-052",
		name: "잇피티(역삼점)",
		category: "샐러드",
		distanceMeters: 449,
	},
	{
		id: "company-nearby-053",
		name: "초가집삼계탕",
		category: "한식",
		distanceMeters: 452,
	},
	{
		id: "company-nearby-054",
		name: "마찌 김치찌개&고기냉면",
		category: "한식",
		distanceMeters: 455,
	},
	{
		id: "company-nearby-055",
		name: "베어스타코 본점",
		category: "양식",
		distanceMeters: 455,
	},
	{
		id: "company-nearby-056",
		name: "삼보(Sambo)",
		category: "양식",
		distanceMeters: 460,
	},
	{
		id: "company-nearby-057",
		name: "세븐일레븐 강남선릉점",
		category: "편의점",
		distanceMeters: 460,
	},
	{
		id: "company-nearby-058",
		name: "아구아구",
		category: "한식",
		distanceMeters: 464,
	},
	{
		id: "company-nearby-059",
		name: "고향집(르네상스)",
		category: "한식",
		distanceMeters: 467,
	},
	{
		id: "company-nearby-060",
		name: "잼라운지",
		category: "양식",
		distanceMeters: 467,
	},
	{
		id: "company-nearby-061",
		name: "별족발",
		category: "한식",
		distanceMeters: 469,
	},
	{
		id: "company-nearby-062",
		name: "기찬메밀국수(삼성점)",
		category: "한식",
		distanceMeters: 471,
	},
	{
		id: "company-nearby-063",
		name: "스몰톡커피",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 472,
	},
	{
		id: "company-nearby-064",
		name: "프랭크버거(논현아크로힐스점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 474,
	},
	{
		id: "company-nearby-065",
		name: "차돌박힌쭈꾸미 선릉점",
		category: "한식",
		distanceMeters: 479,
	},
	{
		id: "company-nearby-066",
		name: "가츠몽 논현아크로힐스점",
		category: "일식",
		distanceMeters: 480,
	},
	{
		id: "company-nearby-067",
		name: "전수창오리주물럭 강남역삼직영점",
		category: "한식",
		distanceMeters: 480,
	},
	{
		id: "company-nearby-068",
		name: "동해식당(선릉)",
		category: "한식",
		distanceMeters: 481,
	},
	{
		id: "company-nearby-069",
		name: "순대국집정해장 역삼본점",
		category: "한식",
		distanceMeters: 481,
	},
	{
		id: "company-nearby-070",
		name: "[점심전용]기네스하우스",
		category: "한식",
		distanceMeters: 484,
	},
	{
		id: "company-nearby-071",
		name: "나비드 김밥",
		category: "한식",
		distanceMeters: 486,
	},
	{
		id: "company-nearby-072",
		name: "매머드익스프레스 역삼FnF점",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 486,
	},
	{
		id: "company-nearby-073",
		name: "봄담아 선릉역점",
		category: "한식",
		distanceMeters: 487,
	},
	{
		id: "company-nearby-074",
		name: "오포 선릉역점",
		category: "아시안푸드",
		distanceMeters: 487,
	},
	{
		id: "company-nearby-075",
		name: "압구정순대국 선정릉점",
		category: "한식",
		distanceMeters: 489,
	},
	{
		id: "company-nearby-076",
		name: "파리바게뜨 카페선릉",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 492,
	},
	{
		id: "company-nearby-077",
		name: "GS25 역삼미래점",
		category: "편의점/마트",
		distanceMeters: 493,
	},
	{
		id: "company-nearby-078",
		name: "세븐일레븐 역삼칼리도점",
		category: "편의점",
		distanceMeters: 495,
	},
	{
		id: "company-nearby-079",
		name: "한정남의샤오차이 강남본점",
		category: "중식",
		distanceMeters: 495,
	},
	{
		id: "company-nearby-080",
		name: "브라운돈까스(선릉역점)",
		category: "양식",
		distanceMeters: 496,
	},
	{
		id: "company-nearby-081",
		name: "찌개집1979",
		category: "한식",
		distanceMeters: 497,
	},
	{
		id: "company-nearby-082",
		name: "멍텅구리꼼장어",
		category: "한식",
		distanceMeters: 498,
	},
	{
		id: "company-nearby-083",
		name: "커피데스크",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 498,
	},
	{
		id: "company-nearby-084",
		name: "제이돈까스",
		category: "일식",
		distanceMeters: 499,
	},
	{
		id: "company-nearby-085",
		name: "참치부라더스",
		category: "일식",
		distanceMeters: 499,
	},
	{
		id: "company-nearby-086",
		name: "고향집",
		category: "한식",
		distanceMeters: 502,
	},
	{
		id: "company-nearby-087",
		name: "마초갈비 선릉점",
		category: "한식",
		distanceMeters: 502,
	},
	{
		id: "company-nearby-088",
		name: "백암",
		category: "한식",
		distanceMeters: 503,
	},
	{
		id: "company-nearby-089",
		name: "삼백집(역삼점역)",
		category: "한식",
		distanceMeters: 506,
	},
	{
		id: "company-nearby-090",
		name: "투썸플레이스(선릉로점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 511,
	},
	{
		id: "company-nearby-091",
		name: "반포식스 선릉역점",
		category: "아시안푸드",
		distanceMeters: 512,
	},
	{
		id: "company-nearby-092",
		name: "바나프레소(선릉역점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 518,
	},
	{
		id: "company-nearby-093",
		name: "생활맥주(한식뷔페)",
		category: "한식",
		distanceMeters: 521,
	},
	{
		id: "company-nearby-094",
		name: "서래향",
		category: "중식",
		distanceMeters: 523,
	},
	{
		id: "company-nearby-095",
		name: "GS25(역삼상록점)",
		category: "편의점/마트",
		distanceMeters: 529,
	},
	{
		id: "company-nearby-096",
		name: "명동칼국수(선릉점)",
		category: "한식",
		distanceMeters: 539,
	},
	{
		id: "company-nearby-097",
		name: "아름부찌",
		category: "한식",
		distanceMeters: 550,
	},
	{
		id: "company-nearby-098",
		name: "아리스타커피(선릉2호점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 553,
	},
	{
		id: "company-nearby-099",
		name: "천하일품추어탕(선릉)",
		category: "한식",
		distanceMeters: 553,
	},
	{
		id: "company-nearby-100",
		name: "매반생면(선릉점)",
		category: "한식",
		distanceMeters: 558,
	},
	{
		id: "company-nearby-101",
		name: "맘스터치랩(선릉역점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 559,
	},
	{
		id: "company-nearby-102",
		name: "샐러디(선릉점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 559,
	},
	{
		id: "company-nearby-103",
		name: "언제나커피(서울삼성점)",
		category: "확인 불가",
		distanceMeters: 559,
	},
	{
		id: "company-nearby-104",
		name: "22FEB",
		category: "양식",
		distanceMeters: 565,
	},
	{
		id: "company-nearby-105",
		name: "선릉가든",
		category: "한식",
		distanceMeters: 566,
	},
	{
		id: "company-nearby-106",
		name: "착형(선릉점)",
		category: "카페/베이커리/패스트푸드",
		distanceMeters: 566,
	},
	{
		id: "company-nearby-107",
		name: "구영회참치&초밥 강남점",
		category: "일식",
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
	landingFraction = 0.5,
): number {
	validateIndex(winnerIndex, count);
	if (!Number.isFinite(previousRotation) || previousRotation < 0) {
		throw new RangeError("룰렛 회전값을 확인해 주세요.");
	}
	if (
		!Number.isFinite(landingFraction) ||
		landingFraction < 0.1 ||
		landingFraction > 0.9
	) {
		throw new RangeError("룰렛 정지 위치를 확인해 주세요.");
	}
	const winnerAngle = ((winnerIndex + landingFraction) * 360) / count;
	const target = (360 - winnerAngle) % 360;
	const correction = (target - (previousRotation % 360) + 360) % 360;
	const rotation = previousRotation + 4 * 360 + correction;
	if (!Number.isFinite(rotation) || rotation - previousRotation < 4 * 360) {
		throw new RangeError("룰렛 회전값이 너무 큽니다.");
	}
	return rotation;
}

/** Cosmetic randomness never changes the independently chosen winner. */
export function randomWheelLandingFraction(): number {
	const [value] = crypto.getRandomValues(new Uint32Array(1));
	return 0.1 + (value / 2 ** 32) * 0.8;
}
