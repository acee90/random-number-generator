import { MessageScroller as Primitive } from "@shadcn/react/message-scroller";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// shadcn/ui Message Scroller, adapted to the room's responsive sizing.
export { useMessageScroller } from "@shadcn/react/message-scroller";

export const MessageScrollerProvider = Primitive.Provider;

export function MessageScroller({
	className,
	...props
}: ComponentProps<typeof Primitive.Root>) {
	return (
		<Primitive.Root
			data-slot="message-scroller"
			className={cn("relative flex min-h-0 min-w-0 flex-col", className)}
			{...props}
		/>
	);
}

export function MessageScrollerViewport({
	className,
	...props
}: ComponentProps<typeof Primitive.Viewport>) {
	return (
		<Primitive.Viewport
			data-slot="message-scroller-viewport"
			className={cn(
				"min-h-0 flex-1 overflow-y-auto overscroll-contain",
				className,
			)}
			{...props}
		/>
	);
}

export function MessageScrollerContent({
	className,
	...props
}: ComponentProps<typeof Primitive.Content>) {
	return (
		<Primitive.Content
			data-slot="message-scroller-content"
			className={cn("flex min-w-0 flex-col", className)}
			{...props}
		/>
	);
}

export function MessageScrollerItem(
	props: ComponentProps<typeof Primitive.Item>,
) {
	return <Primitive.Item data-slot="message-scroller-item" {...props} />;
}
