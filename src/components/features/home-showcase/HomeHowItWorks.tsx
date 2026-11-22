import {
	Check,
	Copy,
	Link2,
	MousePointer2,
	Plus,
	ThumbsDown,
	ThumbsUp,
	UserRound,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const STEP_STAGGER_MS = 1050;
const PLAYBACK_TAIL_MS = 2600;

const steps = [
	{
		scene: "create",
		title: "첫 추첨 후보를 준비해요",
		description:
			"보드게임, 볼링 같은 후보를 적거나 저장한 목록을 불러와 방을 만들어요.",
	},
	{
		scene: "invite",
		title: "링크로 친구를 초대해요",
		description:
			"친구는 링크로 입장해요. 방장이 추천을 열면 하고 싶은 활동도 보탤 수 있어요.",
	},
	{
		scene: "draw",
		title: "룰렛으로 하나 뽑아요",
		description: "확정한 후보를 룰렛으로 뽑고, 모두 같은 결과를 확인해요.",
	},
	{
		scene: "react",
		title: "결과에 반응을 남겨요",
		description: "참가자는 뽑힌 후보에 좋아요나 싫어요를 남길 수 있어요.",
	},
] as const;

function Cursor() {
	return <MousePointer2 className="how-cursor" size={22} />;
}

function Line({ short = false }: { short?: boolean }) {
	return (
		<Skeleton
			className={`how-line animate-none${short ? " how-line-short" : ""}`}
		/>
	);
}

function Illustration({ scene }: { scene: (typeof steps)[number]["scene"] }) {
	if (scene === "react")
		return (
			<div className="how-window how-react">
				<div className="how-outcome">
					<Check size={13} />
					<Line short />
				</div>
				<div className="how-react-buttons">
					<span>
						<ThumbsUp size={12} />
						<i />
					</span>
					<span>
						<ThumbsDown size={12} />
						<i />
					</span>
				</div>
				<div className="how-action">
					<ThumbsUp size={14} />
					<Cursor />
				</div>
			</div>
		);
	if (scene === "draw")
		return (
			<div className="how-window how-draw">
				<div className="how-wheel">
					<div className="how-wheel-disc" />
					<div className="how-wheel-hub">
						<Cursor />
					</div>
				</div>
				<div className="how-outcome">
					<Check size={13} />
					<Line short />
				</div>
			</div>
		);
	if (scene === "invite")
		return (
			<div className="how-window how-invite">
				<Line short />
				<div className="how-share-row">
					<div className="how-field">
						<Link2 size={13} />
						<Line />
					</div>
					<div className="how-action">
						<Copy size={13} />
						<Cursor />
					</div>
				</div>
				<div className="how-person">
					<span>
						<UserRound size={12} />
					</span>
					<Line />
				</div>
				<div className="how-person how-new-person">
					<span>
						<UserRound size={12} />
					</span>
					<Line short />
				</div>
			</div>
		);
	return (
		<div className="how-window how-create">
			<Line short />
			<div className="how-field">
				<Line />
			</div>
			<div className="how-candidates">
				<i />
				<i />
				<i className="how-added">
					<Check size={10} />
				</i>
			</div>
			<div className="how-action">
				<Plus size={14} />
				<Cursor />
			</div>
		</div>
	);
}

export default function HomeHowItWorks() {
	const list = useRef<HTMLOListElement>(null);
	useEffect(() => {
		if (!list.current || typeof IntersectionObserver === "undefined") return;
		const cards = Array.from(list.current.children) as HTMLElement[];
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		let active = false;
		let frame: number | undefined;
		let timer: number | undefined;
		const cycleDuration =
			(cards.length - 1) * STEP_STAGGER_MS + PLAYBACK_TAIL_MS;

		function playSequence() {
			for (const [index, card] of cards.entries()) {
				card.dataset.playback = "idle";
				card.style.setProperty("--how-delay", `${index * STEP_STAGGER_MS}ms`);
			}
			frame = window.requestAnimationFrame(() => {
				frame = undefined;
				if (!active) return;
				for (const card of cards) card.dataset.playback = "play";
				timer = window.setTimeout(() => {
					timer = undefined;
					playSequence();
				}, cycleDuration);
			});
		}

		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry) return;
				if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
					if (!active) {
						active = true;
						playSequence();
					}
				} else if (active) {
					active = false;
					if (frame !== undefined) window.cancelAnimationFrame(frame);
					if (timer !== undefined) window.clearTimeout(timer);
					frame = undefined;
					timer = undefined;
					for (const card of cards) card.dataset.playback = "idle";
				}
			},
			{ threshold: [0, 0.5] },
		);
		observer.observe(list.current);
		return () => {
			active = false;
			observer.disconnect();
			if (frame !== undefined) window.cancelAnimationFrame(frame);
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, []);
	return (
		<section className="home-how" aria-labelledby="home-how-title">
			<h2 id="home-how-title">이용 방법</h2>
			<ol className="home-how-steps" ref={list}>
				{steps.map((step, index) => (
					<li key={step.scene}>
						<div className="how-stage" aria-hidden="true">
							<span className="how-step-number">STEP 0{index + 1}</span>
							<Illustration scene={step.scene} />
						</div>
						<div className="how-copy">
							<h3>{step.title}</h3>
							<p>{step.description}</p>
						</div>
					</li>
				))}
			</ol>
		</section>
	);
}
