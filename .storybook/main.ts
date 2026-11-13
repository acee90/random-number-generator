import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
	stories: ["../stories/core/*.stories.tsx"],
	framework: "@storybook/react-vite",
	addons: [],
	core: {
		disableTelemetry: true,
		builder: {
			name: "@storybook/builder-vite",
			options: {
				viteConfigPath: fileURLToPath(
					new URL("./vite.config.ts", import.meta.url),
				),
			},
		},
	},
	typescript: { reactDocgen: false },
};
export default config;
