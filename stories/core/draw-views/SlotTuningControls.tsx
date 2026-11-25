import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { type SlotTuning, slotTuningLimits } from "./slotTuningMotion";
import "./slot-tuning-controls.css";

type Knob = {
	label: string;
	unit: string;
	help?: string;
};

const tuningKnobs: Record<keyof SlotTuning, Knob> = {
	initialSpeed: {
		label: "시작 속도",
		unit: "칸/초",
		help: "새 추첨을 시작할 때 적용돼요.",
	},
	maxSpeed: { label: "최고 속도", unit: "칸/초" },
	acceleration: { label: "가속도", unit: "칸/초²" },
	easeInSeconds: {
		label: "가속 전환 (Ease-in)",
		unit: "초",
		help: "가속도가 설정값까지 올라가는 시간이에요.",
	},
	tapBoost: {
		label: "재가속 보너스",
		unit: "칸/초",
		help: "감속 중 버튼을 다시 누를 때 속도에 더해져요.",
	},
	coastSeconds: {
		label: "정지 시간",
		unit: "초",
		help: "버튼을 놓은 뒤 당첨 칸까지 이동하는 목표 시간이에요.",
	},
	easeOutSeconds: {
		label: "감속 전환 (Ease-out)",
		unit: "초",
		help: "짧을수록 버튼을 놓은 직후 속도가 더 빠르게 줄어요.",
	},
	brakeStrength: {
		label: "제동 강도",
		unit: "%",
		help: "높을수록 초반 감속의 비중이 커져요.",
	},
};

const knobGroups: { label: string; keys: (keyof SlotTuning)[] }[] = [
	{
		label: "가속",
		keys: [
			"initialSpeed",
			"maxSpeed",
			"acceleration",
			"easeInSeconds",
			"tapBoost",
		],
	},
	{
		label: "감속과 정지",
		keys: ["coastSeconds", "easeOutSeconds", "brakeStrength"],
	},
];

type KnobSliderProps = Knob & {
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
};

function KnobSlider({
	label,
	unit,
	help,
	value,
	min,
	max,
	step,
	onChange,
}: KnobSliderProps) {
	const labelId = useId();
	const helpId = useId();
	const displayedValue = unit === "%" ? Math.round(value * 100) : value;
	const valueText = `${displayedValue}${unit === "%" ? "" : " "}${unit}`;

	return (
		<div className="slot-tuning-knob">
			<div className="slot-tuning-knob-label">
				<span id={labelId}>{label}</span>
				<span aria-hidden="true">{valueText}</span>
			</div>
			<Slider
				className="slot-tuning-slider"
				value={[value]}
				min={min}
				max={max}
				step={step}
				onValueChange={([next]) => onChange(next)}
				getThumbProps={() => ({
					"aria-labelledby": labelId,
					"aria-describedby": help ? helpId : undefined,
					"aria-valuetext": valueText,
				})}
			/>
			{help && (
				<p id={helpId} className="slot-tuning-knob-help">
					{help}
				</p>
			)}
		</div>
	);
}

export function SlotTuningControls({
	tuning,
	blurPx,
	onChange,
	onBlurChange,
	onReset,
}: {
	tuning: SlotTuning;
	blurPx: number;
	onChange: (next: SlotTuning) => void;
	onBlurChange: (value: number) => void;
	onReset: () => void;
}) {
	const titleId = useId();

	return (
		<section className="slot-tuning-controls" aria-labelledby={titleId}>
			<header className="slot-tuning-controls-header">
				<h2 id={titleId}>조정 설정</h2>
				<Button variant="outline" size="touch" onClick={onReset}>
					기본값 복원
				</Button>
			</header>
			{knobGroups.map(({ label, keys }) => (
				<fieldset key={label}>
					<legend>{label}</legend>
					<div className="slot-tuning-knobs">
						{keys.map((key) => (
							<KnobSlider
								key={key}
								{...tuningKnobs[key]}
								{...slotTuningLimits[key]}
								value={tuning[key]}
								onChange={(value) => onChange({ ...tuning, [key]: value })}
							/>
						))}
					</div>
				</fieldset>
			))}
			<fieldset>
				<legend>화면 효과</legend>
				<div className="slot-tuning-knobs">
					<KnobSlider
						label="최대 모션 블러"
						unit="px"
						min={0}
						max={4}
						step={0.1}
						value={blurPx}
						onChange={onBlurChange}
					/>
				</div>
			</fieldset>
		</section>
	);
}
