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

This is a TanStack Start application with Cloudflare Workers deployment. It's a random number generator that fetches entropy seeds from external sources (quantum/atmospheric noise APIs) and falls back to server-side Web Crypto CSPRNG.

### Key Directories

- `src/routes/` - File-based routing (TanStack Router). `__root.tsx` is the root layout, `index.tsx` is the home page
- `src/components/ui/` - Radix-based UI primitives (shadcn/ui style)
- `src/components/features/` - Feature components (e.g., `RandomGenerator.tsx`)
- `src/components/layout/` - Layout components (`RootLayout.tsx`, `AppSidebar.tsx`)
- `src/services/` - Business logic and API clients

### Random Number Generation Flow

The `RandomGenerator` component offers random integers, Lotto 6/45, and Pension Lottery 720+. `generateRandomNumbers()` and `generateLotteryNumbers()` fetch fresh entropy per request; sources are tried in order:
1. **Priority 1**: ANU Quantum Numbers (`api.quantumnumbers.anu.edu.au`), authenticated with `ANU_API_KEY` via `x-api-key`; skipped if no key is configured
2. **Priority 2**: Random.org Atmospheric Noise, using JSON-RPC with `RANDOM_ORG_API_KEY` when configured, otherwise the public HTTP API
3. **Priority 3**: Web Crypto API (CSPRNG) - local fallback

`randomCore.ts` uses rejection sampling and sparse Fisher–Yates to produce unbiased results without duplicates when requested. `SEED_POOL` KV is diagnostic only, never a shared entropy consumption queue. The source used is displayed in the result UI, including mixed sources. Browser settings/history use localStorage with legacy cookie migration. Copy `.env.example` to `.env.local` for local keys; `.dev.vars` takes precedence if present. `RANDOM_ORG_HASHED_API_KEY` is an unused legacy setting.

### Path Aliases

Use `@/` for imports from `src/` (configured in `tsconfig.json`).

## Code Style

- Biome for linting and formatting (tabs, double quotes)
- Run `npx biome check --write .` to format/lint
- UI text is in Korean
