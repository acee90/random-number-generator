import { lazy } from "react";

export const NearbyRestaurantEntry = lazy(
	() => import("./NearbyRestaurantPicker"),
);
