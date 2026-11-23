import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The shadcn/ui New York Message layout, using this app's theme tokens.
export function Message({
	align = "start",
	className,
	...props
}: ComponentProps<"div"> & { align?: "start" | "end" }) {
	return (
		<div
			data-slot="message"
			data-align={align}
			className={cn(
				"flex min-w-0 items-start gap-2 data-[align=end]:justify-end",
				className,
			)}
			{...props}
		/>
	);
}

export function MessageAvatar({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			data-slot="message-avatar"
			className={cn(
				"grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export function MessageContent({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="message-content"
			className={cn("flex min-w-0 max-w-full flex-col", className)}
			{...props}
		/>
	);
}

export function MessageHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="message-header"
			className={cn("text-xs font-semibold text-muted-foreground", className)}
			{...props}
		/>
	);
}

export function MessageFooter({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="message-footer"
			className={cn("text-xs text-muted-foreground", className)}
			{...props}
		/>
	);
}
