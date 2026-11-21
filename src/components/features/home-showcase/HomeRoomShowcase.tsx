import { Check, Crown, LockKeyhole, Trophy, UserRound } from "lucide-react";
import { useState } from "react";
import guestCompact from "@/assets/home-preview/guest-compact.webp";
import guestWide from "@/assets/home-preview/guest-wide.webp";
import hostCompact from "@/assets/home-preview/host-compact.webp";
import hostWide from "@/assets/home-preview/host-wide.webp";
import resultCompact from "@/assets/home-preview/result-compact.webp";
import resultWide from "@/assets/home-preview/result-wide.webp";
import { Button } from "@/components/ui/button";
import { homeRoomExample as example } from "@/data/homeRoomExample";
import "./home-showcase.css";

const views = [
	{
		key: "host",
		label: "방장 화면",
		Icon: Crown,
		wide: hostWide,
		compact: hostCompact,
		alt: `${[...example.activities, example.recommendation].join("·")} 룰렛과 방장용 돌리기 버튼`,
	},
	{
		key: "guest",
		label: "참가자 화면",
		Icon: UserRound,
		wide: guestWide,
		compact: guestCompact,
		alt: `참가자 화면의 ‘${example.recommendation}’이 입력된 후보 추천 칸과 추천하기 버튼`,
	},
	{
		key: "result",
		label: "추첨 결과",
		Icon: Trophy,
		wide: resultWide,
		compact: resultCompact,
		alt: `${example.recommendation}이 당첨된 결과 화면과 참가자의 좋아요 반응`,
	},
] as const;

export default function HomeRoomShowcase() {
	const [selected, setSelected] = useState<(typeof views)[number]>(views[0]);
	return (
		<section className="home-showcase" aria-labelledby="home-room-example">
			<div className="home-showcase-heading">
				<h2 id="home-room-example">방장과 참가자 화면 둘러보기</h2>
				<fieldset className="home-view-picker">
					<legend className="sr-only">예시 화면 선택</legend>
					{views.map((view) => (
						<Button
							key={view.key}
							size="sm"
							variant={selected === view ? "secondary" : "outline"}
							aria-pressed={selected === view}
							aria-controls="home-room-frame"
							onClick={() => setSelected(view)}
						>
							{selected === view ? (
								<Check size={16} aria-hidden="true" />
							) : (
								<view.Icon size={16} aria-hidden="true" />
							)}
							{view.label}
						</Button>
					))}
				</fieldset>
			</div>
			<figure className="home-room-figure" id="home-room-frame">
				<div className="home-browser">
					<div className="home-browser-bar" aria-hidden="true">
						<span className="home-browser-dots">
							<i />
							<i />
							<i />
						</span>
						<span className="home-browser-address">
							<LockKeyhole size={12} />
							jeommechu.dev
						</span>
					</div>
					<picture>
						<source
							media="(max-width: 640px)"
							srcSet={selected.compact}
							width="420"
							height="640"
						/>
						<img
							src={selected.wide}
							width="1080"
							height="640"
							loading="lazy"
							decoding="async"
							alt={selected.alt}
						/>
					</picture>
				</div>
			</figure>
		</section>
	);
}
