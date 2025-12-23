import { createFileRoute } from "@tanstack/react-router";
import RandomGenerator from "@/components/features/RandomGenerator";

export const Route = createFileRoute("/")({ component: RandomGenerator });
