import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import RouteNotFound from "@/components/features/RouteNotFound";
import RootLayout from "@/components/layout/RootLayout";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	notFoundComponent: RouteNotFound,
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "랜덤랩 · 랜덤 숫자, 로또, 연금복권 번호 생성기",
			},
			{
				name: "description",
				content:
					"양자 랜덤 숫자 생성기(QRNG), 대기 노이즈, 암호학적으로 안전한 랜덤 숫자를 생성합니다. ANU Quantum RNG와 Random.org를 활용한 고품질 난수 생성 서비스.",
			},
			{
				name: "keywords",
				content:
					"난수 생성기, 랜덤 숫자, 양자 난수, QRNG, Random.org, 암호화 난수, CSPRNG",
			},
			{
				name: "author",
				content: "Random Number Generator",
			},
			{
				name: "theme-color",
				content: "#d6f266",
			},
			// Open Graph
			{
				property: "og:type",
				content: "website",
			},
			{
				property: "og:title",
				content: "랜덤랩 · 랜덤 숫자, 로또, 연금복권 번호 생성기",
			},
			{
				property: "og:description",
				content:
					"양자 난수 생성기(QRNG), 대기 노이즈, 암호학적으로 안전한 난수를 생성합니다.",
			},
			{
				property: "og:image",
				content: "/og-image.png",
			},
			{
				property: "og:locale",
				content: "ko_KR",
			},
			// Twitter Card
			{
				name: "twitter:card",
				content: "summary_large_image",
			},
			{
				name: "twitter:title",
				content: "랜덤랩 · 랜덤 숫자, 로또, 연금복권 번호 생성기",
			},
			{
				name: "twitter:description",
				content:
					"양자 난수 생성기(QRNG), 대기 노이즈, 암호학적으로 안전한 난수를 생성합니다.",
			},
			{
				name: "twitter:image",
				content: "/og-image.png",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg",
			},
			{
				rel: "icon",
				type: "image/x-icon",
				href: "/favicon.ico",
			},
			{
				rel: "apple-touch-icon",
				href: "/apple-touch-icon.png",
			},
			{
				rel: "manifest",
				href: "/manifest.json",
			},
		],
	}),

	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="ko">
			<head>
				{import.meta.env.PROD && (
					<>
						<script
							async
							src="https://www.googletagmanager.com/gtm.js?id=GTM-PH7KTBC8"
						/>
						<script
							// Static Google Tag Manager bootstrap; contains no user input.
							// biome-ignore lint/security/noDangerouslySetInnerHtml: Required for the inline GTM bootstrap.
							dangerouslySetInnerHTML={{
								__html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());`,
							}}
						/>
					</>
				)}
				<HeadContent />
			</head>
			<body>
				<RootLayout>{children}</RootLayout>
				<Scripts />
			</body>
		</html>
	);
}
