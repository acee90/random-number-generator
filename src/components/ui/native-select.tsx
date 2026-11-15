import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Keep the native option and keyboard behavior, including existing form refs.
function NativeSelect({ className, ...props }: ComponentProps<"select">) {
	return (
		<select
			data-slot="native-select"
			className={cn("ui-native-select", className)}
			{...props}
		/>
	);
}
export { NativeSelect };
