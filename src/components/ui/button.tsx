import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Game geometry opts into plain/auto while ordinary controls share theme tokens.
const buttonVariants = cva("ui-button gap-2", {
	variants: {
		variant: {
			default: "ui-button-primary",
			outline: "ui-button-outline",
			secondary: "ui-button-secondary",
			destructive: "ui-button-destructive",
			ghost: "ui-button-ghost",
			link: "ui-button-link",
			plain: "ui-button-plain",
		},
		size: {
			default: "h-9 px-4 py-2 has-[>svg]:px-3",
			sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
			touch: "h-11 gap-1.5 px-3 has-[>svg]:px-2.5",
			lg: "h-10 px-6 has-[>svg]:px-4",
			icon: "size-9",
			"icon-sm": "size-8",
			"icon-lg": "size-10",
			auto: "",
		},
	},
	defaultVariants: { variant: "default", size: "default" },
});

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	type,
	...props
}: ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot : "button";
	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size }), className)}
			type={asChild ? type : (type ?? "button")}
			{...props}
		/>
	);
}
export { Button, buttonVariants };
