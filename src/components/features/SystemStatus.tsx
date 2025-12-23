import {
	Atom,
	CheckCircle,
	Cloud,
	Database,
	RefreshCw,
	Server,
	Shield,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { forceRefillPool, getSystemStatus } from "@/services/randomService";

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
	externalApis: {
		anu: { url: string; status: string };
		randomOrg: { url: string; status: string };
	};
	environment: {
		runtime: string;
	};
}

export default function SystemStatus() {
	const [status, setStatus] = useState<SystemStatusData | null>(null);
	const [loading, setLoading] = useState(true);
	const [refilling, setRefilling] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchStatus = async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await getSystemStatus();
			setStatus(data);
		} catch (e) {
			setError(e instanceof Error ? e.message : "상태 조회 실패");
		} finally {
			setLoading(false);
		}
	};

	const handleRefill = async () => {
		setRefilling(true);
		try {
			await forceRefillPool();
			await fetchStatus();
		} catch (e) {
			setError(e instanceof Error ? e.message : "리필 실패");
		} finally {
			setRefilling(false);
		}
	};

	useEffect(() => {
		fetchStatus();
	}, []);

	const getSourceIcon = (source: string | null) => {
		switch (source) {
			case "quantum":
				return <Atom className="w-4 h-4 text-purple-500" />;
			case "atmospheric":
				return <Cloud className="w-4 h-4 text-blue-500" />;
			case "csprng":
				return <Shield className="w-4 h-4 text-green-500" />;
			default:
				return null;
		}
	};

	const getSourceName = (source: string | null) => {
		switch (source) {
			case "quantum":
				return "ANU Quantum";
			case "atmospheric":
				return "Random.org";
			case "csprng":
				return "CSPRNG";
			default:
				return "없음";
		}
	};

	return (
		<Card className="w-full border-border/50 shadow-xl bg-white/50 dark:bg-black/40 backdrop-blur-md">
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Server className="w-5 h-5 text-indigo-500" />
							시스템 상태
						</CardTitle>
						<CardDescription>KV 바인딩 및 시드 풀 상태</CardDescription>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={fetchStatus}
						disabled={loading}
					>
						<RefreshCw
							className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
						/>
						새로고침
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{error && (
					<div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
						{error}
					</div>
				)}

				{loading && !status ? (
					<div className="flex items-center justify-center py-8 text-muted-foreground">
						<RefreshCw className="w-5 h-5 animate-spin mr-2" />
						상태 확인 중...
					</div>
				) : status ? (
					<div className="space-y-4">
						{/* KV 상태 */}
						<div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
							<div className="flex items-center gap-3">
								<Database className="w-5 h-5 text-muted-foreground" />
								<div>
									<div className="font-medium">KV 바인딩</div>
									<div className="text-xs text-muted-foreground">SEED_POOL</div>
								</div>
							</div>
							<div className="flex items-center gap-2">
								{status.kv.status === "connected" ? (
									<>
										<CheckCircle className="w-4 h-4 text-green-500" />
										<span className="text-sm text-green-600">연결됨</span>
									</>
								) : (
									<>
										<XCircle className="w-4 h-4 text-red-500" />
										<span className="text-sm text-red-600">
											{status.kv.error || "연결 안됨"}
										</span>
									</>
								)}
							</div>
						</div>

						{/* 풀 상태 */}
						<div className="p-3 rounded-lg bg-muted/50 space-y-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									<div className="flex items-center gap-2">
										{getSourceIcon(status.pool.source)}
										<div>
											<div className="font-medium">시드 풀</div>
											<div className="text-xs text-muted-foreground">
												{getSourceName(status.pool.source)}
											</div>
										</div>
									</div>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={handleRefill}
									disabled={refilling}
								>
									{refilling ? (
										<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
									) : (
										<RefreshCw className="w-4 h-4 mr-2" />
									)}
									리필
								</Button>
							</div>

							<div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/50">
								<div>
									<div className="text-xs text-muted-foreground">남은 시드</div>
									<div className="text-lg font-mono font-semibold">
										{status.pool.exists
											? status.pool.remaining.toLocaleString()
											: "-"}
									</div>
								</div>
								<div>
									<div className="text-xs text-muted-foreground">생성 시간</div>
									<div className="text-lg font-mono font-semibold">
										{status.pool.ageMinutes !== null
											? `${status.pool.ageMinutes}분 전`
											: "-"}
									</div>
								</div>
							</div>

							{/* 풀 게이지 */}
							{status.pool.exists && (
								<div className="pt-2">
									<div className="flex justify-between text-xs text-muted-foreground mb-1">
										<span>풀 용량</span>
										<span>
											{Math.round((status.pool.remaining / 1000) * 100)}%
										</span>
									</div>
									<div className="h-2 bg-muted rounded-full overflow-hidden">
										<div
											className={`h-full transition-all ${
												status.pool.remaining > 500
													? "bg-green-500"
													: status.pool.remaining > 100
														? "bg-yellow-500"
														: "bg-red-500"
											}`}
											style={{
												width: `${Math.min((status.pool.remaining / 1000) * 100, 100)}%`,
											}}
										/>
									</div>
								</div>
							)}
						</div>

						{/* 환경 정보 */}
						<div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
							<span>런타임: {status.environment.runtime}</span>
							<span>
								마지막 업데이트:{" "}
								{new Date(status.timestamp).toLocaleTimeString()}
							</span>
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
