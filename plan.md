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
