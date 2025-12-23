import Cookies from "js-cookie";
import {
	ArrowRightLeft,
	Atom,
	Check,
	Cloud,
	Copy,
	Dices,
	History,
	ListOrdered,
	RefreshCw,
	Settings,
	Shield,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
	generateRandomNumbers,
	getSourceDisplayName,
	type RandomSource,
} from "@/services/randomService";

interface HistoryItem {
	id: string;
	timestamp: number;
	numbers: number[];
	source?: RandomSource;
}

interface Settings {
	min: number;
	max: number;
	count: number;
	allowDuplicates: boolean;
	sortResult: boolean;
}

const DEFAULT_SETTINGS: Settings = {
	min: 1,
	max: 10000,
	count: 1,
	allowDuplicates: false,
	sortResult: true,
};

export default function RandomGenerator() {
	const [min, setMin] = useState<number>(DEFAULT_SETTINGS.min);
	const [max, setMax] = useState<number>(DEFAULT_SETTINGS.max);
	const [count, setCount] = useState<number>(DEFAULT_SETTINGS.count);
	const [allowDuplicates, setAllowDuplicates] = useState<boolean>(DEFAULT_SETTINGS.allowDuplicates);
	const [sortResult, setSortResult] = useState<boolean>(DEFAULT_SETTINGS.sortResult);
	const [result, setResult] = useState<number[]>([]);
	const [source, setSource] = useState<RandomSource | null>(null);
	const [isGenerating, setIsGenerating] = useState<boolean>(false);
	const [copied, setCopied] = useState<boolean>(false);
	const [history, setHistory] = useState<HistoryItem[]>([]);
	const id = useId();

	// Load settings and history on mount
	useEffect(() => {
		const savedSettings = Cookies.get("rng_settings");
		if (savedSettings) {
			try {
				const settings: Settings = JSON.parse(savedSettings);
				setMin(settings.min ?? DEFAULT_SETTINGS.min);
				setMax(settings.max ?? DEFAULT_SETTINGS.max);
				setCount(settings.count ?? DEFAULT_SETTINGS.count);
				setAllowDuplicates(settings.allowDuplicates ?? DEFAULT_SETTINGS.allowDuplicates);
				setSortResult(settings.sortResult ?? DEFAULT_SETTINGS.sortResult);
			} catch (e) {
				console.error("Failed to parse settings", e);
			}
		}

		const savedHistory = Cookies.get("rng_history");
		if (savedHistory) {
			try {
				setHistory(JSON.parse(savedHistory));
			} catch (e) {
				console.error("Failed to parse history", e);
			}
		}
	}, []);

	// Save settings when changed
	useEffect(() => {
		const settings: Settings = { min, max, count, allowDuplicates, sortResult };
		Cookies.set("rng_settings", JSON.stringify(settings), { expires: 365 });
	}, [min, max, count, allowDuplicates, sortResult]);

	const saveHistory = (newHistory: HistoryItem[]) => {
		setHistory(newHistory);
		Cookies.set("rng_history", JSON.stringify(newHistory), { expires: 365 });
	};

	const clearHistory = () => {
		saveHistory([]);
	};

	const handleGenerateNumbers = async () => {
		setIsGenerating(true);
		setResult([]);
		setSource(null);

		const range = max - min + 1;

		if (!allowDuplicates && count > range) {
			alert("범위가 유니크한 숫자를 생성하기에 너무 작습니다!");
			setIsGenerating(false);
			return;
		}

		try {
			const genResult = await generateRandomNumbers({
				data: { min, max, count, unique: !allowDuplicates },
			});

			let numbers = genResult.numbers;

			if (sortResult) {
				numbers = [...numbers].sort((a, b) => a - b);
			}

			const newItem: HistoryItem = {
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				numbers,
				source: genResult.source,
			};

			const newHistory = [newItem, ...history].slice(0, 50);
			saveHistory(newHistory);

			setResult(numbers);
			setSource(genResult.source);
		} catch (error) {
			console.error("Failed to generate random numbers:", error);
			alert("난수 생성 중 오류가 발생했습니다.");
		} finally {
			setIsGenerating(false);
		}
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="flex flex-col w-full max-w-6xl mx-auto p-4 gap-6">
			<div className="text-center space-y-2">
				<h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 drop-shadow-sm">
					랜덤 숫자 생성기
				</h1>
				<p className="text-muted-foreground text-lg max-w-lg mx-auto">
					원하는 조건에 맞는 랜덤 숫자를 간편하고 멋지게 생성해보세요.
				</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
				{/* Left Column - Controls & Results */}
				<div className="lg:col-span-2 flex flex-col gap-6 justify-between">
					{/* Controls Card */}
					<Card className="w-full border-border/50 shadow-xl bg-white/50 dark:bg-black/40 backdrop-blur-md">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Settings className="w-5 h-5 text-indigo-500" />
								설정
							</CardTitle>
							<CardDescription>생성 옵션을 설정하세요</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="space-y-4">
								<div className="grid grid-cols-2 gap-4">
									<div className="space-y-2">
										<Label htmlFor={`${id}-min`}>최소값</Label>
										<Input
											id={`${id}-min`}
											type="number"
											value={min}
											onChange={(e) => setMin(Number(e.target.value))}
											className="bg-white/50 dark:bg-black/20"
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor={`${id}-max`}>최대값</Label>
										<Input
											id={`${id}-max`}
											type="number"
											value={max}
											onChange={(e) => setMax(Number(e.target.value))}
											className="bg-white/50 dark:bg-black/20"
										/>
									</div>
								</div>

								<div className="space-y-3">
									<div className="flex justify-between">
										<Label>개수: {count}</Label>
									</div>
									<Slider
										value={[count]}
										onValueChange={(vals) => setCount(vals[0])}
										min={1}
										max={100}
										step={1}
										className="py-2"
									/>
								</div>

								<Separator />

								<div className="flex items-center justify-between">
									<div className="flex items-center space-x-2">
										<ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
										<Label
											htmlFor={`${id}-duplicates`}
											className="cursor-pointer"
										>
											중복 허용
										</Label>
									</div>
									<Switch
										id={`${id}-duplicates`}
										checked={allowDuplicates}
										onCheckedChange={setAllowDuplicates}
									/>
								</div>

								<div className="flex items-center justify-between">
									<div className="flex items-center space-x-2">
										<ListOrdered className="w-4 h-4 text-muted-foreground" />
										<Label htmlFor={`${id}-sort`} className="cursor-pointer">
											결과 정렬
										</Label>
									</div>
									<Switch
										id={`${id}-sort`}
										checked={sortResult}
										onCheckedChange={setSortResult}
									/>
								</div>
							</div>
						</CardContent>
						<CardFooter>
							<Button
								className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/20 transition-all hover:scale-[1.02]"
								onClick={handleGenerateNumbers}
								disabled={isGenerating}
							>
								{isGenerating ? (
									<RefreshCw className="mr-2 h-5 w-5 animate-spin" />
								) : (
									<Dices className="mr-2 h-5 w-5" />
								)}
								{isGenerating ? "생성 중..." : "숫자 생성하기"}
							</Button>
						</CardFooter>
					</Card>

					{/* Results Card */}
					<Card className="w-full border-border/50 shadow-xl bg-linear-to-br from-indigo-50/50 to-purple-50/50 dark:from-indigo-950/20 dark:to-purple-950/20 backdrop-blur-md flex flex-col min-h-[200px]">
						<CardHeader className="flex flex-row items-center justify-between">
							<div>
								<CardTitle className="flex items-center gap-2">
									<Sparkles className="w-5 h-5 text-purple-500" />
									결과
								</CardTitle>
								<CardDescription>생성된 숫자</CardDescription>
							</div>
							{result.length > 0 && (
								<Button
									variant="outline"
									size="sm"
									onClick={() => copyToClipboard(result.join(", "))}
									className="transition-all active:scale-95"
								>
									{copied ? (
										<Check className="h-4 w-4 mr-2 text-green-500" />
									) : (
										<Copy className="h-4 w-4 mr-2" />
									)}
									{copied ? "복사됨" : "복사"}
								</Button>
							)}
						</CardHeader>
						<CardContent className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
							{result.length === 0 ? (
								<div className="text-center text-muted-foreground space-y-4 opacity-50">
									<div className="bg-muted/30 p-6 rounded-full inline-block">
										<Dices className="w-12 h-12" />
									</div>
									<p>생성하기 버튼을 눌러보세요</p>
								</div>
							) : (
								<>
									<div className="w-full p-4 flex items-center justify-center">
										<p className="text-2xl md:text-3xl font-mono font-medium leading-relaxed text-center break-all text-secondary-foreground">
											{result.join(", ")}
										</p>
									</div>
									{source && (
										<div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-xs text-muted-foreground">
											{source === "quantum" && (
												<Atom className="w-3.5 h-3.5 text-purple-500" />
											)}
											{source === "atmospheric" && (
												<Cloud className="w-3.5 h-3.5 text-blue-500" />
											)}
											{source === "csprng" && (
												<Shield className="w-3.5 h-3.5 text-green-500" />
											)}
											<span>{getSourceDisplayName(source)}</span>
										</div>
									)}
								</>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Right Column - History */}
				<div className="lg:col-span-1 flex max-h-[720px]">
					<Card className="w-full border-border/50 shadow-xl bg-white/50 dark:bg-black/40 backdrop-blur-md flex flex-col">
						<CardHeader className="pb-3 shrink-0">
							<div className="flex items-center justify-between">
								<CardTitle className="flex items-center gap-2 text-base">
									<History className="w-4 h-4 text-indigo-500" />
									기록
								</CardTitle>
								{history.length > 0 && (
									<Button
										variant="ghost"
										size="sm"
										onClick={clearHistory}
										className="text-destructive hover:text-destructive h-7 px-2"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</Button>
								)}
							</div>
						</CardHeader>
						<ScrollArea className="pt-0 flex-1 px-4 mr-3 overflow-hidden">
							{history.length === 0 ? (
								<div className="flex flex-col items-center justify-center h-full text-muted-foreground">
									<History className="h-8 w-8 mb-2 opacity-20" />
									<p className="text-sm">기록이 없습니다.</p>
								</div>
							) : (
								<div className="space-y-3">
									{history.map((item) => (
										<div
											key={item.id}
											className="bg-muted/50 p-3 rounded-lg space-y-1.5"
										>
											<div className="flex justify-between items-center text-xs text-muted-foreground">
												<div className="flex items-center gap-1.5">
													<span>
														{new Date(item.timestamp).toLocaleTimeString()}
													</span>
													{item.source && (
														<span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-background/50">
															{item.source === "quantum" && (
																<Atom className="w-2.5 h-2.5 text-purple-500" />
															)}
															{item.source === "atmospheric" && (
																<Cloud className="w-2.5 h-2.5 text-blue-500" />
															)}
															{item.source === "csprng" && (
																<Shield className="w-2.5 h-2.5 text-green-500" />
															)}
														</span>
													)}
												</div>
												<Button
													variant="ghost"
													size="icon"
													className="h-5 w-5"
													onClick={() =>
														copyToClipboard(item.numbers.join(", "))
													}
												>
													<Copy className="h-2.5 w-2.5" />
												</Button>
											</div>
											<div className="font-mono text-sm font-medium break-all">
												{item.numbers.join(", ")}
											</div>
										</div>
									))}
								</div>
							)}
						</ScrollArea>
					</Card>
				</div>
			</div>
		</div>
	);
}
