import { CheckCircle, Database, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { getSystemStatus } from "@/services/randomApi";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface SystemStatusData {
	timestamp: number;
	kv: {
		status: "connected" | "error" | "unavailable";
		error: string | null;
	};
	pool: {
		exists: boolean;
		remaining: number;
		source: string | null;
		ageMinutes: number | null;
	};
}

const POOL_MAX = 1000;

export default function SystemStatusBar() {
	const [status, setStatus] = useState<SystemStatusData | null>(null);

	useEffect(() => {
		const fetchStatus = async () => {
			try {
				const data = await getSystemStatus();
				setStatus(data);
			} catch {
				// 실패 시 무시
			}
		};

		fetchStatus();
		const interval = setInterval(fetchStatus, 30000); // 30초마다 갱신
		return () => clearInterval(interval);
	}, []);

	if (!status) return null;

	const poolPercent = status.pool.exists
		? Math.round((status.pool.remaining / POOL_MAX) * 100)
		: 0;

	const getPoolColor = () => {
		if (poolPercent > 50) return "bg-green-500";
		if (poolPercent > 20) return "bg-yellow-500";
		return "bg-red-500";
	};

	return (
		<TooltipProvider>
			<div className="h-8 px-4 flex items-center justify-end gap-4 text-xs text-muted-foreground border-t border-border/50 bg-background/80 backdrop-blur-sm">
				{/* KV 상태 */}
				<div className="flex items-center gap-1.5">
					<Database className="w-3 h-3" />
					<span>KV</span>
					{status.kv.status === "connected" ? (
						<CheckCircle className="w-3 h-3 text-green-500" />
					) : (
						<XCircle className="w-3 h-3 text-red-500" />
					)}
				</div>

				{/* Pool 게이지 */}
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="flex items-center gap-2 cursor-default">
							<span>Pool</span>
							<div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
								<div
									className={`h-full transition-all ${getPoolColor()}`}
									style={{ width: `${poolPercent}%` }}
								/>
							</div>
							<span className="w-8 text-right">{poolPercent}%</span>
						</div>
					</TooltipTrigger>
					<TooltipContent side="top">
						<p>
							남은 시드: {status.pool.remaining.toLocaleString()} / {POOL_MAX.toLocaleString()}
						</p>
					</TooltipContent>
				</Tooltip>
			</div>
		</TooltipProvider>
	);
}
