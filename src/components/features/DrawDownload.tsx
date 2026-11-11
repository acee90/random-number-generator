import { Download } from "lucide-react";
import { useId, useState } from "react";
import { createDrawText, type TextDraw } from "@/lib/drawText";

export default function DrawDownload({
	draw,
	sourceLabel,
	strategy,
}: {
	draw: TextDraw;
	sourceLabel: string;
	strategy?: string;
}) {
	const id = useId();
	const [error, setError] = useState("");
	function download() {
		let objectUrl: string | undefined;
		let link: HTMLAnchorElement | undefined;
		const objectUrls = typeof URL === "undefined" ? undefined : URL;
		try {
			if (
				typeof Blob !== "function" ||
				!objectUrls ||
				typeof objectUrls.createObjectURL !== "function" ||
				typeof objectUrls.revokeObjectURL !== "function"
			) {
				throw new Error("File downloads are unavailable");
			}
			link = document.createElement("a");
			if (!("download" in link))
				throw new Error("File downloads are unavailable");
			const { text, filename } = createDrawText(draw, {
				sourceLabel,
				strategy,
			});
			objectUrl = objectUrls.createObjectURL(
				new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" }),
			);
			link.href = objectUrl;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			setError("");
		} catch {
			setError(
				"텍스트 파일을 저장하지 못했습니다. 결과를 복사해 간직해 주세요.",
			);
		} finally {
			link?.remove();
			if (objectUrl && objectUrls) {
				const usedUrl = objectUrl;
				setTimeout(() => objectUrls.revokeObjectURL(usedUrl), 0);
			}
		}
	}
	return (
		<div>
			<button
				type="button"
				className="result-copy"
				onClick={download}
				aria-describedby={error ? `${id}-download-error` : undefined}
				title="생성 시각과 난수 출처를 함께 저장"
			>
				<Download size={15} aria-hidden="true" /> 텍스트로 저장
			</button>
			<p
				id={`${id}-download-error`}
				className={error ? "inline-error" : undefined}
				role="alert"
			>
				{error}
			</p>
		</div>
	);
}
