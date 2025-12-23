import { AppSidebar } from "@/components/layout/AppSidebar";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset className="bg-linear-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950 transition-colors duration-500 overflow-hidden">
				<header className="flex h-16 shrink-0 items-center gap-2 px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b border-black/5 dark:border-white/5 backdrop-blur-sm sticky top-0 z-10">
					<div className="flex items-center gap-2 px-4">
						<SidebarTrigger className="-ml-1" />
					</div>
				</header>
				<div className="flex flex-1 flex-col gap-4 p-4 lg:p-8 pt-0 overflow-auto h-[calc(100vh-4rem)]">
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
