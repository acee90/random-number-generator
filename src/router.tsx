import { createRouter } from "@tanstack/react-router";
import RouteError from "@/components/features/RouteError";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

import "./styles.css";

// Create a new router instance
export const getRouter = () => {
	const router = createRouter({
		routeTree,
		defaultErrorComponent: RouteError,
		scrollRestoration: true,
		defaultPreloadStaleTime: 0,
	});

	return router;
};
