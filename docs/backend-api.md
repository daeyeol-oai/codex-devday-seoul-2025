# Backend API Contracts

The backend exposes Node runtime API routes that integrate directly with OpenAI Images (`gpt-image-1-mini`), Sora videos (`sora-2`), and the Codex SDK. Responses are JSON-serializable so the same contracts can be reused in production.

> **Environment prerequisite**: set `OPENAI_API_KEY` in `.env.local` before starting the dev server. All endpoints throw if the key is missing.

## `POST /api/images/generate`

Generates five landscape PNGs from a textual prompt. You may optionally attach a sketch reference that is forwarded to the OpenAI Images edit endpoint. Accepts `multipart/form-data`:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `prompt` | text | ✅ | Prompt forwarded to `gpt-image-1-mini`. |
| `sketch` | file | optional | Optional reference sketch; normalized to PNG and supplied as `image` when present. |

Successful response (`201`):

```json
{
  "runId": "images-20241127041030-abc123",
  "createdAt": "2024-11-27T04:10:30.120Z",
  "prompt": "Robot exploring a library",
  "sketch": {
    "fileName": "ref.png",
    "url": "/outputs/images-20241127041030-abc123/input/ref.png"
  },
  "images": [
    {
      "id": "images-20241127041030-abc123-img-1",
      "fileName": "image-1.png",
      "url": "/outputs/images-20241127041030-abc123/images/image-1.png",
      "createdAt": "2024-11-27T04:10:30.120Z",
      "model": "gpt-image-1-mini",
      "size": "1536x1024"
    }
  ],
  "model": "gpt-image-1-mini",
  "usedReference": true
}
```

All generated PNGs are written to `public/outputs/<runId>/images/`. Validation failures (missing prompt or unsupported reference image) return `400` with `{ "error": "..." }`. The response includes `usedReference: true` when a sketch was supplied.

## `GET /api/images/latest`

Discovers the most recent image/video run. Priority order:

1. `public/outputs/chosen/`
2. Most recently modified run directory under `public/outputs/`

Successful response (`200`):

```json
{
  "runId": "images-20241127041030-abc123",
  "images": [
    {
      "fileName": "image-1.png",
      "url": "/outputs/images-20241127041030-abc123/images/image-1.png",
      "relativePath": "images-20241127041030-abc123/images/image-1.png",
      "updatedAt": "2024-11-27T04:10:32.210Z"
    }
  ],
  "video": {
    "fileName": "video.mp4",
    "url": "/outputs/images-20241127041030-abc123/video.mp4",
    "relativePath": "images-20241127041030-abc123/video.mp4",
    "updatedAt": "2024-11-27T04:15:12.000Z"
  },
  "progress": {
    "status": "completed",
    "progress": 100
  }
}
```

If no runs exist the route returns `404`.

## `POST /api/videos/generate`

Creates an 8 second, 1280×720 video through Sora. Request body (`application/json`):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `prompt` | string | ✅ | Prompt forwarded to `sora-2`. |
| `imageUrl` | string | ✅ | `/outputs/...` URL of the selected image. |
| `runId` | string | optional | Explicit run scope; inferred from `imageUrl` if omitted. |
| `seconds` | number\|string | optional | Defaults to `8`. Accepts `4`, `8`, or `12`. |
| `size` | string | optional | Defaults to `1280x720`. Must be a supported Sora size. |

Workflow:

1. Selected image is resized to 1280×720 PNG (`public/outputs/<runId>/video/reference.png`).
2. `openai.videos.create` submits the request to `sora-2`.
3. The endpoint polls `openai.videos.retrieve` until completion (or failure) updating `progress.json` on each step.
4. Final media is downloaded via `openai.videos.downloadContent` into `public/outputs/<runId>/video.mp4`.

Successful response (`201`):

```json
{
  "runId": "images-20241127041030-abc123",
  "prompt": "Compile selected frames into a teaser",
  "seconds": "8",
  "size": "1280x720",
  "video": {
    "url": "/outputs/images-20241127041030-abc123/video.mp4",
    "fileName": "video.mp4",
    "id": "video_456"
  },
  "progress": {
    "runId": "images-20241127041030-abc123",
    "prompt": "Compile selected frames into a teaser",
    "model": "sora-2",
    "videoId": "video_456",
    "status": "completed",
    "progress": 100,
    "seconds": "8",
    "size": "1280x720",
    "startedAt": "2024-11-27T04:10:30.300Z",
    "updatedAt": "2024-11-27T04:15:12.000Z",
    "history": [
      {
        "status": "queued",
        "progress": 5,
        "timestamp": "2024-11-27T04:10:30.300Z"
      },
      {
        "status": "in_progress",
        "progress": 45,
        "timestamp": "2024-11-27T04:10:32.306Z"
      },
      {
        "status": "completed",
        "progress": 100,
        "timestamp": "2024-11-27T04:15:12.000Z"
      }
    ],
    "assets": {
      "video": "/outputs/images-20241127041030-abc123/video.mp4",
      "reference": "/outputs/images-20241127041030-abc123/video/reference.png",
      "images": ["/outputs/images-20241127041030-abc123/images/image-1.png"]
    }
  }
}
```

Errors:

- missing prompt or image ⇒ `400`
- invalid local path ⇒ `400`
- Sora failures ⇒ `502` with the upstream error message
- timeout ⇒ `504`

Once the request begins, progress updates are written to `public/outputs/<runId>/progress.json` so the UI can poll independently.

## `POST /api/codex/agent`

Starts a Codex thread and streams events over SSE (`text/event-stream`). Request body:

```json
{ "prompt": "Diagnose the failing lint step and propose a fix" }
```

Each SSE payload uses `event: message` and a JSON body `{ "type": string, "text"?: string, "payload"?: object }`. Examples include:

- `type: "thread.started"` — Codex thread ID.
- `type: "plan.updated"` — todo list items (`payload.items`).
- `type: "command.started" | "command.updated" | "command.completed"` — command lines, status, output.
- `type: "file.change"` — changed file list.
- `type: "agent.message"`, `type: "reasoning"` — natural language responses/thoughts.
- `type: "error"` — non-recoverable issues; UI should mark the run as failed.
- `type: "turn.completed"` — token usage summary.

When execution finishes the stream emits `event: done` with `{ "ok": true }` on success or `{ "ok": false }` on failure and then closes. Clients should parse SSE lines (`event:`/`data:`) in order and update the UI incrementally. The thread runs with sandbox mode `workspace-write` rooted at the repository.

## `POST /api/codex/theme`

Applies a theme override by rewriting `styles/theme.css`. Request body:

```json
{ "primary": "#2563eb", "accent": "#38bdf8" }
```

Only hex colours are accepted. The endpoint returns:

```json
{ "ok": true, "theme": { "primary": "#2563eb", "accent": "#38bdf8" }, "snapshotCreated": true }
```

## `POST /api/codex/undo`

Attempts to restore the latest git snapshot created by the agent/theme routes.

- Success ⇒ `200 { "ok": true }`
- No snapshot ⇒ `409 { "ok": false, "reason": "..." }`
- Git errors ⇒ `500 { "ok": false, "error": "..." }`

## Local Verification

- `npm run lint` – typecheck and lint.
- Inspect `public/outputs/<runId>/` for generated PNGs, `progress.json`, and `video.mp4`.
- Use `curl -N -X POST http://localhost:3000/api/codex/agent -H 'Content-Type: application/json' -d '{"prompt":"..."}'` to inspect raw SSE output.
- `git stash list` will reflect snapshots recorded by the Codex endpoints.
