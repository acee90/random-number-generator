import { Copy, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import "./copy-fallback.css";

interface CopyFallbackProps {
	text: string;
	onClose: () => void;
	onRetry: () => void;
}

export default function CopyFallback({
	text,
	onClose,
	onRetry,
}: CopyFallbackProps) {
	const id = useId();
	const fieldRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		fieldRef.current?.focus();
		fieldRef.current?.select();
	}, []);

	return (
		<section
			className="inline-error copy-fallback"
			aria-label="직접 복사 도움말"
		>
			<div className="copy-fallback-heading">
				<strong>자동 복사가 안 됐습니다.</strong>
				<button
					type="button"
					className="text-button"
					aria-label="복사 도움말 닫기"
					onClick={onClose}
				>
					<X size={16} aria-hidden="true" /> 닫기
				</button>
			</div>
			<p id={`${id}-help`}>
				아래 내용을 직접 복사해 주세요. 컴퓨터에서는 Ctrl+C 또는 ⌘C를 누르고,
				휴대폰에서는 길게 눌러 복사할 수 있습니다.
			</p>
			<label htmlFor={`${id}-text`}>복사할 결과</label>
			<textarea
				ref={fieldRef}
				id={`${id}-text`}
				value={text}
				readOnly
				rows={Math.min(5, Math.max(2, text.split("\n").length))}
				aria-describedby={`${id}-help`}
			/>
			<button type="button" className="result-copy" onClick={onRetry}>
				<Copy size={16} aria-hidden="true" /> 다시 복사
			</button>
		</section>
	);
}
