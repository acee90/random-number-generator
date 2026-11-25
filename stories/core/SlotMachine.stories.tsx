import type { Meta, StoryObj } from "@storybook/react-vite";
import { SlotMotionLab } from "./draw-views/SlotMotionLab";

const meta = {
	id: "core-slot-machine",
	title: "시안/슬롯머신",
	component: SlotMotionLab,
} satisfies Meta<typeof SlotMotionLab>;

export default meta;

export const MotionTuning: StoryObj<typeof meta> = { name: "회전 튜닝" };
