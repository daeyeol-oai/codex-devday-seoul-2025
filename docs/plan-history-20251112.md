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
- [x] Bind primary CTA/background colours to `--accent-primary` / `--accent-secondary` tokens so theme changes propagate without manual restyling.

## 4. State & Interactions
- [x] Manage upload file, prompt text, and generated images via React state in the page component; wire callbacks to child components.
- [x] Stub service calls for “Generate 5 images”, “Load latest”, and “Create video with Sora” with placeholder async functions until back-end endpoints are defined.
- [x] Handle selection logic inside `GeneratedGallery`; expose `onSelect(id)` to inform parent state.

## 5. Media Handling
- [x] Represent generated images with static mock data first; later replace with real URLs.
- [x] Use the native `<video>` element for the preview; show a placeholder poster or message when no video is available.

## 6. Accessibility & Feedback
- [x] Provide descriptive labels (`aria-label`, `aria-describedby`) for inputs and buttons.
- [x] Implement keyboard navigation for gallery cards and visualize focus alongside selection.
- [x] Surface loading/disabled states on action buttons when async calls run.

## 7. Validation & Follow-up
- [x] Run `npm run lint` and manual browser checks before sign-off.
- [x] Track outstanding work (API integration, real asset pipelines, error handling) for future tasks.

## 8. Backend API Implementation
- [x] Scaffold Node runtime API routes in `app/api/` for images, latest assets, video generation, and Codex builder controls.
- [x] Implement multipart handler that validates prompt and sketch inputs, saves uploads under `public/outputs/<runId>/`, and returns five-image metadata as JSON.
- [x] Build latest assets endpoint that prioritizes `chosen/` directories, falls back to newest timestamped run, and returns image plus video URLs in a consistent JSON payload.
- [x] Create video generation endpoint that validates JSON payload, records staged progress updates to `progress.json`, and emits the final 8-second video URL.
- [x] Deliver Codex SSE endpoint that streams plan/command/file-change/error events while enforcing workspace-write sandbox and git stash snapshots for undo.
- [x] Introduce singleton OpenAI and Codex SDK clients with early failure when `OPENAI_API_KEY` is missing.
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
- [x] Ensure Codex agent/theme runs always capture post-run snapshots so undo restores the pre-run workspace state regardless of existing changes.
- [x] **Event normalization**: Stream all SSE payloads as `event: message` with `{ type, text, payload }` so the UI can display consistent logs.
- [x] **Completion signals**: Send `event: done` with `{ ok: true/false }` and ensure error states close the stream immediately.
- [x] **Undo/Theme API parity**: Align `/api/codex/undo` and `/api/codex/theme` responses to `{ ok: true/false, ... }` for predictable client handling.
- [x] **Theme picker state**: Hydrate colour pickers on load by reading current CSS variables or a theme metadata endpoint so manual overrides survive refresh.
- [x] **Snapshot availability**: Expose an endpoint to report stored Codex snapshots and initialise the Undo button state accordingly.
- [x] **Theme snapshot timing**: Adjust theme API flow so snapshots are created after writes, guaranteeing undo availability even from a clean workspace.
- [x] **Snapshot prune**: Automatically drop stale `.codex-snapshots.json` entries when git stashes are missing and continue undo with the next available snapshot.
- [x] **Codex-driven theme edits**: Route Apply Theme requests through a Codex plan so CSS rewrites happen via the agent under sandbox controls.
- [x] **Codex SSE wiring**: Stream Codex theme run progress back into the SidePanel UI, showing plan/command output during theme updates.
- [x] **Final response event**: Surface the Codex turn `finalResponse` in SSE output and include it with the completion payload.

## 11. Image Generation Enhancements *(completed)*
- [x] Update the UI flow so `Generate images` works with text-only prompts, making the sketch upload optional while keeping prompt input mandatory.
- [x] Extend `/api/images/generate` to detect when a sketch is present; encode it and call OpenAI Images with `image` + `prompt`. For text-only requests, keep the current prompt-based generation.
- [x] Store and surface whether a run used a reference image so the gallery can display context (e.g., “from sketch” badges if needed).
- [x] Add error messaging for unsupported sketch formats and ensure text-only mode still returns informative errors.
- [x] Document the optional reference workflow in `docs/backend-api.md` and `agents.md` so future maintainers know how inputs are forwarded to OpenAI.

## Active Tasks

### Codex image attachments
- [x] Extend `/api/codex/agent` payload/schema so a turn can include zero or more local image paths and forward them to `thread.runStreamed`.
- [x] Create an upload flow that writes selected files to `.codex-uploads/<uuid>/` (add folder to `.gitignore`) and returns the stored path.
- [x] Update the Run Codex client UI with an "Attach image" control, show/remove pending attachments, and include their paths whenever the user runs Codex.

### Codex upload storage
- [x] Move upload persistence to `public/codex-run/<uuid>` and update APIs/ignore lists so Codex and the UI read from the new location.

### Inpainting workflow
- [x] Add an “Inpainting” entry point beside the existing upload/run buttons in `SidePanel`, capture the current viewport via `html-to-image`, and open a fullscreen overlay.
- [x] Build the overlay editor with `react-konva` so users can draw thick red pen strokes, drag speech-bubble sticky notes (with movable tails), define a crop box, undo edits, and cancel/done actions.
- [x] When a user hits Done, export the edited region (respecting the crop) to PNG, pipe it through the existing attachment upload flow, and surface it in the attachment list just like manual uploads.

### Video asset restructuring
- [x] Store every Sora render under `videos/<token>/` with unique short tokens so multiple videos can coexist per run.
- [x] Write per-job progress snapshots to `sora-progress-<token>.json`, embed metadata inside `metadata.json`, and surface the new structure through `GET /api/images/latest`.
- [x] Update the web client to generate tokens, poll the correct progress file, and consume the enriched API/types without relying on legacy `progress.json`.

