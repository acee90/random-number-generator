import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Input({
	className,
	type = "text",
	...props
}: ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn("ui-input", className)}
			{...props}
		/>
	);
}
export { Input };
