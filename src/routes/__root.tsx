import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import RouteNotFound from "@/components/features/RouteNotFound";
import RootLayout from "@/components/layout/RootLayout";
import { createSeoHead, lunchPageSeo } from "@/lib/seo";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	notFoundComponent: RouteNotFound,
	head: () => ({
		meta: [
			...createSeoHead({
				title: lunchPageSeo.home.title,
				description: lunchPageSeo.home.description,
			}).meta,
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				name: "author",
				content: "Jeommechu",
			},
			{
				name: "theme-color",
				content: "#d6f266",
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
