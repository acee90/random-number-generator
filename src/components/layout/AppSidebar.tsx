import { Dices, Gift, Settings, Sparkles, Ticket } from "lucide-react";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@/components/ui/sidebar";

export function AppSidebar() {
	return (
		<Sidebar className="border-r border-white/10 bg-black/20 backdrop-blur-xl supports-backdrop-filter:bg-black/10">
			<SidebarHeader>
				<div className="flex items-center gap-2 px-4 py-3">
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-indigo-500 via-purple-500 to-pink-500">
						<Sparkles className="h-4 w-4 text-white" />
					</div>
					<span className="text-lg font-bold bg-clip-text text-transparent bg-linear-to-r from-indigo-400 to-purple-400">
						Random Tools
					</span>
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel className="text-xs uppercase text-muted-foreground/70 tracking-wider">
						앱
					</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton
									isActive
									className="data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
								>
									<a href="/" className="flex items-center gap-2 w-full">
										<Dices className="h-4 w-4" />
										<span>숫자 생성기</span>
									</a>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton
									disabled
									className="opacity-50 cursor-not-allowed hover:bg-transparent"
								>
									<div className="flex items-center gap-2 w-full">
										<Ticket className="h-4 w-4" />
										<span>로또 번호</span>
										<span className="ml-auto text-[10px] bg-muted/20 px-1.5 py-0.5 rounded-full">
											준비중
										</span>
									</div>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton
									disabled
									className="opacity-50 cursor-not-allowed hover:bg-transparent"
								>
									<div className="flex items-center gap-2 w-full">
										<Gift className="h-4 w-4" />
										<span>제비뽑기</span>
										<span className="ml-auto text-[10px] bg-muted/20 px-1.5 py-0.5 rounded-full">
											준비중
										</span>
									</div>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarGroup className="mt-auto">
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton>
									<Settings className="h-4 w-4" />
									<span>설정</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarRail />
		</Sidebar>
	);
}
