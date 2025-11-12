# UI Build Plan – Summary

_Last reset: 2025-11-12. Previous snapshot archived in docs/plan-history-20251112.md._

## Progress Snapshot
- The "Building Stories" UI shell, component scaffold, accessibility, and interaction flows are complete end-to-end.
- Media handling covers uploads, load-latest, and Sora video previews with polished gallery selection states and async feedback.
- Backend APIs for images, latest assets, video, and Codex are wired to OpenAI with SSE streaming plus snapshot guard rails.
- Codex workflow hardening and image-generation enhancements (optional sketch usage, error messaging, docs) passed lint + manual verification.

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
