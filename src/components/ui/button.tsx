import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Game geometry opts into plain/auto while ordinary controls share theme tokens.
const buttonVariants = cva("ui-button", {
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
			default: "ui-button-default",
			sm: "ui-button-sm",
			lg: "ui-button-lg",
			icon: "ui-button-icon",
			"icon-sm": "ui-button-icon",
			"icon-lg": "ui-button-icon-lg",
			auto: "ui-button-auto",
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
