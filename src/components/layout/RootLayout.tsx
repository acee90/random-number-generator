export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<>
			<a className="skip-link" href="#main-content">
				본문으로 건너뛰기
			</a>
			{children}
		</>
	);
}
