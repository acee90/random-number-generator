import type { Preview } from "@storybook/react-vite";
import "../src/styles.css";
import "./preview.css";

const preview: Preview = {
	parameters: {
		layout: "fullscreen",
		controls: { expanded: true },
		viewport: {
			options: {
				phone: {
					name: "모바일 390px",
					styles: { width: "390px", height: "844px" },
					type: "mobile",
				},
				smallPhone: {
					name: "작은 모바일 320px",
					styles: { width: "320px", height: "800px" },
					type: "mobile",
				},
				desktop: {
					name: "PC 1280px",
					styles: { width: "1280px", height: "1000px" },
					type: "desktop",
				},
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="random-lab lunch-room sb-core">
				<Story />
			</div>
		),
	],
};
export default preview;
