export const siteOrigin = "https://jeommechu.dev";
export const socialImage = `${siteOrigin}/og-jeommechu-simple.png`;
export const privateRobots = "noindex, nofollow";

export type RoomShareInfo =
	| { status: "open"; title: string }
	| { status: "closed" | "expired" | "missing" | "unavailable" };

export function createRoomSeoHead(roomId: string, info?: RoomShareInfo) {
	const shareUrl = `${siteOrigin}/lunch-room/${encodeURIComponent(roomId)}`;
	const unavailableTitles = {
		closed: "종료된 추첨방 · 점메추",
		expired: "만료된 추첨방 · 점메추",
		missing: "찾을 수 없는 추첨방 · 점메추",
		unavailable: lunchPageSeo.room.title,
	};
	return createSeoHead({
		title:
			info?.status === "open"
				? `${info.title} · 점메추 방 초대`
				: unavailableTitles[info?.status ?? "unavailable"],
		description: shareUrl,
		shareUrl,
	});
}

export const lunchPageSeo = {
	home: {
		title: "점메추 · 점심 메뉴 룰렛과 함께하는 추첨",
		description:
			"점심 메뉴부터 다음 모임 활동까지, 우리만의 후보 목록으로 룰렛을 돌려 보세요. 링크로 초대받은 친구도 후보를 추천하고 같은 추첨 결과를 확인할 수 있어요.",
		path: "/",
	},
	solo: {
		title: "점심 메뉴 룰렛 · 혼자 추첨하기 | 점메추",
		description:
			"제공된 음식점 목록을 분류별로 고르고 룰렛으로 오늘 점심을 정하세요. 원하는 후보를 포함하거나 제외하고, 추첨 결과와 난수 출처 및 최근 기록을 확인할 수 있습니다.",
		path: "/solo",
	},
	room: {
		title: "점심 추첨방 입장 · 점메추",
		description:
			"닉네임을 정해 점심 추첨방에 입장하세요. 함께 같은 룰렛을 보고 채팅하며 오늘 갈 식당을 정할 수 있습니다.",
	},
} as const;

/** Only public, fixed routes receive a canonical URL or indexing permission. */
export function createSeoHead({
	title,
	description,
	path,
	shareUrl,
}: {
	title: string;
	description: string;
	path?: "/" | "/solo";
	shareUrl?: string;
}) {
	const canonical = path ? `${siteOrigin}${path === "/" ? "/" : path}` : null;
	const openGraphUrl = canonical ?? shareUrl;
	return {
		meta: [
			{ title },
			{ name: "description", content: description },
			{
				name: "robots",
				content: canonical ? "index, follow" : privateRobots,
			},
			{ property: "og:site_name", content: "점메추" },
			{ property: "og:type", content: "website" },
			{ property: "og:locale", content: "ko_KR" },
			{ property: "og:title", content: title },
			{ property: "og:description", content: description },
			...(openGraphUrl ? [{ property: "og:url", content: openGraphUrl }] : []),
			{ property: "og:image", content: socialImage },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ property: "og:image:type", content: "image/png" },
			{
				property: "og:image:alt",
				content: "큰 점메추 글자와 라임색 점심 메뉴 룰렛",
			},
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: title },
			{ name: "twitter:description", content: description },
			{ name: "twitter:image", content: socialImage },
			{
				name: "twitter:image:alt",
				content: "큰 점메추 글자와 라임색 점심 메뉴 룰렛",
			},
		],
		links: canonical ? [{ rel: "canonical", href: canonical }] : [],
	};
}
