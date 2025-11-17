# Repository Guidelines

## Project Structure & Module Organization
The project is a Next.js App Router workspace. Route entry points live in `app/`; `app/page.tsx` renders the default landing page and `app/layout.tsx` wires global providers. Shared styles reside in `app/globals.css`. Static assets such as icons, fonts, and images belong in `public/`. Configuration files (`next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`) sit at the root; adjust them rather than duplicating settings inside source folders.

## Build, Test, and Development Commands
Use `npm run dev` for the local development server at `http://localhost:3000`, which hot-reloads on file changes. `npm run build` produces the optimized production bundle; run it before release-focused pull requests. Start a production build locally with `npm run start` after building to validate server behaviour. Quality gate with `npm run lint`, which applies the Next.js ESLint preset.

## Coding Style & Naming Conventions
Follow the default Next.js + TypeScript style: 2-space indentation, semicolons omitted, and single quotes for strings unless template literals are needed. Name React components in `PascalCase`, hooks/utilities in `camelCase`, and files that export components using the component name (for example, `HeroSection.tsx`). Keep App Router segments lowercase and hyphenated (`app/(marketing)/pricing/page.tsx`). Rely on the configured ESLint rules and Prettier-compatible formatting; run your editor’s formatter before committing.

## Testing Guidelines
Automated tests are not yet configured—add them alongside features. Co-locate component tests in `__tests__/` directories near the source or under `tests/` at the root for integration flows. Use `@testing-library/react` for UI coverage and `msw` for API mocking when needed. Document new test commands in `package.json` scripts and ensure they run in CI. Until a test runner is added, always execute `npm run lint` and manually verify critical flows in the browser.

## Commit & Pull Request Guidelines
Write commits in the imperative mood (`Add landing hero layout`) and keep them scoped to a single concern. Prefer smaller commits that map cleanly to reviewable changes. Pull requests should include: a concise summary of intent, screenshots or GIFs for UI updates, reproduction steps for bug fixes, and references to issue IDs when applicable. Confirm `npm run lint` (and any test scripts you introduce) succeed before requesting review; note remaining risks or follow-up work directly in the PR description.
- Obtain explicit user approval before creating any git commit.
- After completing work, provide the exact `git commit` command for the approved changes.

## Codex Agent Workflow Notes
- `/api/codex/agent` streams Codex SDK events as Server-Sent Events using the unified format `event: message` with `{ type, text, payload }`, plus a terminal `event: done` carrying `{ ok: true/false }`.
- Codex runs within `workspace-write` sandbox mode confined to the repository root. No automatic git snapshot is created at turn start; snapshots are deferred to the edit-application phase.
- `/api/codex/theme` and `/api/codex/undo` now return `{ ok: true/false, ... }` so the UI can provide consistent feedback.
- Further hardening tasks—edit verification, abort handling, snapshot cleanup—are tracked under “Codex Workflow Hardening” in the historical plan backup and should be referenced before extending the agent.

## Image Generation Notes
- `/api/images/generate` accepts text-only prompts and an optional sketch. When supplied, the sketch is normalized to PNG and passed to the OpenAI Images edit endpoint; otherwise the prompt is sent to `images.generate`.
- Responses include `usedReference` so the UI can indicate whether a run used a sketch. `metadata.json` mirrors this flag for the latest-assets endpoint.
