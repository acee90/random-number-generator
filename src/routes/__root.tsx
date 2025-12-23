import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import RootLayout from "@/components/layout/RootLayout";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
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
				title: "난수 생성기 - 양자/대기 노이즈 기반 진정한 난수",
			},
			{
				name: "description",
				content:
					"양자 난수 생성기(QRNG), 대기 노이즈, 암호학적으로 안전한 난수를 생성합니다. ANU Quantum RNG와 Random.org를 활용한 고품질 난수 생성 서비스.",
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
				content: "#6366F1",
			},
			// Open Graph
			{
				property: "og:type",
				content: "website",
			},
			{
				property: "og:title",
				content: "난수 생성기 - 양자/대기 노이즈 기반 진정한 난수",
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
				content: "난수 생성기 - 양자/대기 노이즈 기반 진정한 난수",
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
			<RootLayout>{children}</RootLayout>
			<TanStackDevtools
				config={{
					position: "bottom-right",
				}}
				plugins={[
					{
						name: "Tanstack Router",
						render: <TanStackRouterDevtoolsPanel />,
					},
				]}
			/>
			<Scripts />
		</html>
	);
}
