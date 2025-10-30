# UI Build Plan – "Building Stories"

## 1. Requirements & Reference Review
- [x] Capture layout elements from the reference mock: title, upload + prompt controls, action buttons, generated image gallery with selection state, optional video description input, primary CTA, and embedded video preview.
- [x] Note behaviour expectations (e.g., display count badge, highlight selected card, handle empty states) pending product decisions.

## 2. Component Structure
- [x] Define responsibilities for `app/page.tsx` to orchestrate page-level layout and state lifting for generated assets.
- [x] Scaffold `components/` tree with:
  - [x] `UploadControls` for file input, prompt field, and action buttons.
  - [x] `GeneratedGallery` for thumbnails, selection, and gallery metadata.
  - [x] `VideoRequestForm` encapsulating final description field and CTA button.
  - [x] `VideoPreview` wrapping the media player element or placeholder state.
- [x] Introduce TypeScript interfaces describing generated assets and selection state.

## 3. Layout & Styling
- [x] Establish a centered column layout with responsive max-width, mirroring the white canvas on neutral background.
- [x] Apply Tailwind utility classes; extend `app/globals.css` only if custom tokens (e.g., accent colour) are required.
- [x] Ensure consistent spacing, focus states, and button variants (primary vs. secondary) matching the mock.

## 4. State & Interactions
- [x] Manage upload file, prompt text, and generated images via React state in the page component; wire callbacks to child components.
- [x] Stub service calls for “Generate 5 images”, “Load latest”, and “Create video with Sora” with placeholder async functions until back-end endpoints are defined.
- [x] Handle selection logic inside `GeneratedGallery`; expose `onSelect(id)` to inform parent state.

## 5. Media Handling
- [x] Represent generated images with static mock data first; later replace with real URLs.
- [x] Use the native `<video>` element for the preview; show a placeholder poster or message when no video is available.
- [ ] Consider drag-and-drop support as a stretch goal if time permits.

## 6. Accessibility & Feedback
- [x] Provide descriptive labels (`aria-label`, `aria-describedby`) for inputs and buttons.
- [x] Implement keyboard navigation for gallery cards and visualize focus alongside selection.
- [x] Surface loading/disabled states on action buttons when async calls run.

## 7. Validation & Follow-up
- [ ] Validate layout in desktop and tablet breakpoints; document gaps for mobile adaptation if scope is desktop-only.
- [x] Run `npm run lint` and manual browser checks before sign-off.
- [x] Track outstanding work (API integration, real asset pipelines, error handling) for future tasks.

## 8. Backend API Implementation
- [x] Scaffold Node runtime API routes in `app/api/` for images, latest assets, video generation, and Codex builder controls.
- [x] Implement multipart handler that validates prompt and sketch inputs, saves uploads under `public/outputs/<runId>/`, and returns five-image metadata as JSON.
- [x] Build latest assets endpoint that prioritizes `chosen/` directories, falls back to newest timestamped run, and returns image plus video URLs in a consistent JSON payload.
- [x] Create video generation endpoint that validates JSON payload, records staged progress updates to `progress.json`, and emits the final 8-second video URL.
- [x] Deliver Codex SSE endpoint that streams plan/command/file-change/error events while enforcing workspace-write sandbox and git stash snapshots for undo.
- [x] Introduce singleton OpenAI and Codex SDK clients with early failure when `OPENAI_API_KEY` is missing.
- [ ] Add filesystem safeguards so only `app/`, `styles/`, and `public/outputs/` are writable; ensure directory creation and path joins are pre-validated. *(Theme updates now use guarded paths; extend checks to broader Codex file edits.)*
- [x] Document API request/response formats and local `.env` requirements once endpoints are in place.

## 9. OpenAI Production Integration *(completed)*
- [x] Rename API routes to match final spec (`/api/images/generate`, `/api/images/latest`, `/api/videos/generate`, `/api/codex/{agent,theme,undo}`) and update front-end consumers.
- [x] Replace image mock generator with OpenAI Images `gpt-image-1-mini` calls (5× portrait PNG) and persist decoded buffers under `public/outputs/<runId>/image-*.png`.
- [x] Implement Sora `sora-2` video generation: preprocess selected image to 1280×720 via `sharp`, submit as `input_reference`, poll job status, stream progress into `progress.json`, and download the final MP4 to the run directory.
- [x] Build front-end request flow in `app/page.tsx` to post multipart sketch + prompt, hydrate gallery state, handle selection and error feedback.
- [x] Add progress polling UI (`VideoPlaceholder` and related components) that reads `progress.json` until the MP4 exists.
- [x] Implement Codex agent/theme/undo endpoints using `@openai/codex-sdk`, enforce sandbox + git snapshot rules, and update `SidePanel` SSE client to render streamed events.
- [x] Ensure filesystem guardrails match allowlist requirements before enabling production model calls.
+ Later: add analytics/logging around model calls or production hardening (rate limits, retries, billing alerts) if needed.

## 10. Codex Workflow Hardening *(planned)*
- [ ] **Agent execution flow**: Keep the SidePanel prompt submission UX, but run Codex without creating git snapshots automatically. Only snapshot when applying edits.
- [ ] **Filesystem safety**: Implement `applyCodexPlan()` and `applyEditsSafely()` to enforce allowed paths (`app/`, `styles/`, `public/outputs/`) and verify `oldText` before writing files.
- [x] **Event normalization**: Stream all SSE payloads as `event: message` with `{ type, text, payload }` so the UI can display consistent logs.
- [x] **Completion signals**: Send `event: done` with `{ ok: true/false }` and ensure error states close the stream immediately.
- [ ] **Abort support**: Add an API or SSE signal so the SidePanel’s “중단” 버튼 can cancel an in-flight Codex run.
- [x] **Undo/Theme API parity**: Align `/api/codex/undo` and `/api/codex/theme` responses to `{ ok: true/false, ... }` for predictable client handling.
- [ ] **Snapshot clean-up**: Track active snapshots and auto-drop stale ones, preventing the stash stack from growing without bounds.
