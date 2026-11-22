import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;
function DialogOverlay({
	className,
	...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			data-slot="dialog-overlay"
			className={cn("ui-dialog-overlay", className)}
			{...props}
		/>
	);
}
function DialogContent({
	children,
	className,
	container,
	showCloseButton = true,
	overlayClassName,
	...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
	container?: ComponentProps<typeof DialogPortal>["container"];
	showCloseButton?: boolean;
	overlayClassName?: string;
}) {
	return (
		<DialogPortal container={container}>
			<DialogOverlay className={overlayClassName} />
			<DialogPrimitive.Content
				data-slot="dialog-content"
				className={cn("ui-dialog-content", className)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogClose asChild>
						<Button
							variant="ghost"
							size="icon"
							className="ui-dialog-close"
							aria-label="닫기"
						>
							<X size={18} aria-hidden="true" />
						</Button>
					</DialogClose>
				)}
			</DialogPrimitive.Content>
		</DialogPortal>
	);
}
function DialogHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			className={cn("ui-dialog-header", className)}
			{...props}
		/>
	);
}
function DialogFooter({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn("ui-dialog-footer", className)}
			{...props}
		/>
	);
}
function DialogTitle({
	className,
	...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("ui-dialog-title", className)}
			{...props}
		/>
	);
}
function DialogDescription({
	className,
	...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("ui-dialog-description", className)}
			{...props}
		/>
	);
}
export {
	Dialog,
	DialogTrigger,
	DialogClose,
	DialogPortal,
	DialogOverlay,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogDescription,
};
