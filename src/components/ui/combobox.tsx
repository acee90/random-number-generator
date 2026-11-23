import { Combobox as Primitive } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown, LoaderCircle, Search } from "lucide-react";
import { type Ref, useEffect, useState } from "react";
import { Button } from "./button";
import { Input } from "./input";
import "./combobox.css";

/** shadcn/ui's single-select popup combobox, using the project's Button and Input. */
export function Combobox<T extends string>({
	label,
	options,
	value,
	onValueChange,
	disabled,
	pending = false,
	triggerRef,
}: {
	label: string;
	options: Readonly<Record<T, string>>;
	value: T;
	onValueChange: (value: T) => void;
	disabled?: boolean;
	pending?: boolean;
	triggerRef?: Ref<HTMLButtonElement>;
}) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (disabled || pending) setOpen(false);
	}, [disabled, pending]);
	return (
		<Primitive.Root<T>
			items={Object.keys(options) as T[]}
			value={value}
			itemToStringLabel={(item) => options[item]}
			disabled={disabled}
			readOnly={pending}
			open={open && !disabled && !pending}
			onOpenChange={setOpen}
			onValueChange={(item) => {
				if (item && item !== value) onValueChange(item);
			}}
		>
			<Primitive.Trigger
				ref={triggerRef}
				aria-busy={pending || undefined}
				aria-label={`${label} · ${options[value]}`}
				render={
					<Button variant="outline" size="sm" className="ui-combobox-trigger" />
				}
			>
				{options[value]}
				{pending ? (
					<LoaderCircle
						className="motion-safe:animate-spin"
						aria-hidden="true"
					/>
				) : (
					<ChevronsUpDown aria-hidden="true" />
				)}
			</Primitive.Trigger>
			<Primitive.Portal>
				<Primitive.Positioner
					align="start"
					sideOffset={4}
					className="ui-combobox-positioner"
				>
					<Primitive.Popup className="ui-combobox-popup" aria-label={label}>
						<div className="ui-combobox-search">
							<Search aria-hidden="true" size={16} />
							<Primitive.Input
								render={<Input />}
								placeholder={`${label} 검색`}
								aria-label={`${label} 검색`}
							/>
						</div>
						<Primitive.Empty className="ui-combobox-empty">
							검색 결과가 없습니다.
						</Primitive.Empty>
						<Primitive.List aria-label={label}>
							{(item: T) => (
								<Primitive.Item
									key={item}
									value={item}
									className="ui-combobox-item"
								>
									{options[item]}
									<Primitive.ItemIndicator>
										<Check size={16} aria-hidden="true" />
									</Primitive.ItemIndicator>
								</Primitive.Item>
							)}
						</Primitive.List>
					</Primitive.Popup>
				</Primitive.Positioner>
			</Primitive.Portal>
		</Primitive.Root>
	);
}
