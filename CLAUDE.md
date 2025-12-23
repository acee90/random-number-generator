# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server on port 3000
npm run build    # Build for production
npm run test     # Run tests with Vitest
npm run deploy   # Build and deploy to Cloudflare Workers
```

## Architecture

This is a TanStack Start application with Cloudflare Workers deployment. It's a random number generator that fetches entropy seeds from external sources (quantum/atmospheric noise APIs) and falls back to browser CSPRNG.

### Key Directories

- `src/routes/` - File-based routing (TanStack Router). `__root.tsx` is the root layout, `index.tsx` is the home page
- `src/components/ui/` - Radix-based UI primitives (shadcn/ui style)
- `src/components/features/` - Feature components (e.g., `RandomGenerator.tsx`)
- `src/components/layout/` - Layout components (`RootLayout.tsx`, `AppSidebar.tsx`)
- `src/services/` - Business logic and API clients

### Random Number Generation Flow

The `RandomGenerator` component (`src/components/features/RandomGenerator.tsx`) uses `randomService` (`src/services/randomService.ts`) which:
1. Fetches a seed from `/api/seed` on initialization
2. Uses a SHA-256 hash chain PRNG seeded with quantum/atmospheric/CSPRNG entropy
3. Persists seed state to localStorage (expires after 24 hours)

### Path Aliases

Use `@/` for imports from `src/` (configured in `tsconfig.json`).

## Code Style

- Biome for linting and formatting (tabs, double quotes)
- Run `npx biome check --write .` to format/lint
- UI text is in Korean
