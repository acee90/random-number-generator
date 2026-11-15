import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;
function AlertDialogOverlay({
	className,
	...props
}: ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
	return (
		<AlertDialogPrimitive.Overlay
			data-slot="alert-dialog-overlay"
			className={cn("ui-dialog-overlay", className)}
			{...props}
		/>
	);
}
function AlertDialogContent({
	className,
	...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
	return (
		<AlertDialogPortal>
			<AlertDialogOverlay />
			<AlertDialogPrimitive.Content
				data-slot="alert-dialog-content"
				className={cn("ui-dialog-content", className)}
				{...props}
			/>
		</AlertDialogPortal>
	);
}
function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-header"
			className={cn("ui-dialog-header", className)}
			{...props}
		/>
	);
}
function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-footer"
			className={cn("ui-dialog-footer", className)}
			{...props}
		/>
	);
}
function AlertDialogTitle({
	className,
	...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
	return (
		<AlertDialogPrimitive.Title
			data-slot="alert-dialog-title"
			className={cn("ui-dialog-title", className)}
			{...props}
		/>
	);
}
function AlertDialogDescription({
	className,
	...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
	return (
		<AlertDialogPrimitive.Description
			data-slot="alert-dialog-description"
			className={cn("ui-dialog-description", className)}
			{...props}
		/>
	);
}
function AlertDialogAction({
	className,
	...props
}: ComponentProps<typeof AlertDialogPrimitive.Action>) {
	return (
		<AlertDialogPrimitive.Action
			data-slot="alert-dialog-action"
			data-variant="default"
			data-size="default"
			className={cn(buttonVariants(), className)}
			{...props}
		/>
	);
}
function AlertDialogCancel({
	className,
	...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
	return (
		<AlertDialogPrimitive.Cancel
			data-slot="alert-dialog-cancel"
			data-variant="outline"
			data-size="default"
			className={cn(buttonVariants({ variant: "outline" }), className)}
			{...props}
		/>
	);
}
export {
	AlertDialog,
	AlertDialogTrigger,
	AlertDialogPortal,
	AlertDialogOverlay,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogFooter,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogAction,
	AlertDialogCancel,
};
