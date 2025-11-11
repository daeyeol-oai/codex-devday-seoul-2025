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
