import { Check, SlidersHorizontal } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "./button";
import "./category-filter.css";

export function CategoryFilterButton({
	controls,
	expanded,
	count,
	total,
	description,
	size = "sm",
	showCount = true,
	active = false,
	popup,
	ref,
	disabled,
	onClick,
}: {
	controls: string;
	expanded: boolean;
	count: number;
	total: number;
	description: string;
	size?: "sm" | "default";
	showCount?: boolean;
	active?: boolean;
	popup?: "dialog";
	ref?: ComponentProps<"button">["ref"];
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<>
			<Button
				ref={ref}
				className="category-filter-trigger"
				variant="outline"
				size={size}
				aria-label="필터"
				aria-expanded={expanded}
				aria-controls={popup && !expanded ? undefined : controls}
				aria-haspopup={popup}
				aria-describedby={`${controls}-count`}
				data-active={active || undefined}
				disabled={disabled}
				onClick={onClick}
			>
				<SlidersHorizontal size={16} aria-hidden="true" />
				필터
				{showCount && (
					<span className="category-filter-count" aria-hidden="true">
						{count}/{total}
					</span>
				)}
				{active && (
					<span className="category-filter-active" aria-hidden="true">
						<Check size={10} strokeWidth={3} />
					</span>
				)}
			</Button>
			<span className="sr-only" id={`${controls}-count`}>
				{active && "필터 적용 중. "}
				{description}
			</span>
		</>
	);
}

export function CategoryFilterChips({
	id,
	legend,
	options,
	selected,
	allSelected,
	total,
	disabled,
	onToggleAll,
	onSelect,
}: {
	id?: string;
	legend: string;
	options: readonly { value: string; count?: number }[];
	selected: readonly string[];
	allSelected: boolean;
	total?: number;
	disabled?: boolean;
	onToggleAll?: () => void;
	onSelect: (category: string | null) => void;
}) {
	return (
		<fieldset id={id} className="category-filter" disabled={disabled}>
			<legend className="sr-only">{legend}</legend>
			<div className="category-filter-chips">
				<Button
					variant="outline"
					size="sm"
					aria-pressed={allSelected}
					disabled={!options.length}
					onClick={() => (onToggleAll ? onToggleAll() : onSelect(null))}
				>
					{onToggleAll && allSelected && <Check size={14} aria-hidden="true" />}
					전체{total !== undefined && ` ${total}`}
				</Button>
				{options.map(({ value, count }) => (
					<Button
						key={value}
						variant="outline"
						size="sm"
						aria-label={count === undefined ? `${value} 분류 포함` : undefined}
						aria-pressed={allSelected || selected.includes(value)}
						onClick={() => onSelect(value)}
					>
						{(allSelected || selected.includes(value)) && (
							<Check size={14} aria-hidden="true" />
						)}
						{value}
						{count !== undefined && ` ${count}`}
					</Button>
				))}
			</div>
		</fieldset>
	);
}
