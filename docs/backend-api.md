# Backend API Contracts

This project exposes mocked Node runtime API routes that mirror the structure of the production services. Requests and responses are JSON-serializable, so the same contracts can be reused once the OpenAI endpoints are wired up.

> **Environment prerequisite**: All API handlers require `OPENAI_API_KEY` to be set (even in mock mode) so misconfigurations are surfaced early. The key should be stored in `.env.local` when running locally.

## `POST /api/images`

Generates five mock image candidates for a sketch prompt. Accepts `multipart/form-data` with the following fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `prompt` | text | ✅ | User-entered description of the sketch. Must be non-empty. |
| `sketch` | file | ✅ | Reference sketch image. Converted to PNG using `sharp`. |

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
      "fileName": "image-1.svg",
      "url": "/outputs/images-20241127041030-abc123/images/image-1.svg",
      "backgroundColor": "#f2d6a0",
      "accentColor": "#d68c45",
      "title": "Quiet companion",
      "description": "Mock illustration generated for prompt: Robot exploring a library",
      "createdAt": "2024-11-27T04:10:30.120Z"
    }
  ]
}
```

Validation errors return `400` with an `error` message (for example missing prompt or unsupported sketch format).

## `GET /api/assets/latest`

Scans `public/outputs/` for the most recent run. Priority:

1. `public/outputs/chosen/`
2. Most recently modified run directory

Response (`200`):

```json
{
  "runId": "images-20241127041030-abc123",
  "images": [
    {
      "fileName": "image-1.svg",
      "url": "/outputs/images-20241127041030-abc123/images/image-1.svg",
      "relativePath": "images-20241127041030-abc123/images/image-1.svg",
      "updatedAt": "2024-11-27T04:10:30.200Z"
    }
  ],
  "video": {
    "fileName": "video.mp4",
    "url": "/outputs/images-20241127041030-abc123/video.mp4",
    "relativePath": "images-20241127041030-abc123/video.mp4",
    "updatedAt": "2024-11-27T04:10:36.000Z"
  },
  "progress": {
    "status": "completed",
    "progress": 100
  }
}
```

If no runs are available the handler responds with `404`.

## `POST /api/videos`

Mocks the Sora video-generation workflow. Expects JSON body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `prompt` | string | ✅ | Description of the video request. |
| `runId` | string | ✅* | If omitted, inferred from the first `imagePaths` entry. |
| `imagePaths` | string[] | ✅ | Paths relative to `public/outputs/`, e.g. `images-20241127041030-abc123/images/image-1.svg`. All entries must map to the same run. |
| `seconds` | number | optional | Defaults to 8 seconds. |
| `size` | string | optional | Defaults to `720x1280`. |

The handler copies a placeholder MP4 into the run directory, writes `progress.json`, and returns (`201`):

```json
{
  "runId": "images-20241127041030-abc123",
  "prompt": "Compile selected frames into a teaser",
  "seconds": 8,
  "size": "720x1280",
  "video": {
    "url": "/outputs/images-20241127041030-abc123/video.mp4",
    "fileName": "video.mp4"
  },
  "progress": {
    "status": "completed",
    "progress": 100,
    "steps": [
      {
        "status": "queued",
        "progress": 5,
        "message": "Queued Sora render job",
        "timestamp": "2024-11-27T04:10:30.300Z"
      }
    ],
    "assets": {
      "video": "/outputs/images-20241127041030-abc123/video.mp4",
      "images": [
        "/outputs/images-20241127041030-abc123/images/image-1.svg"
      ]
    }
  }
}
```

Invalid image references or missing prompts produce `400` responses. Server misconfiguration (for example missing placeholder video) returns `500`.

## `POST /api/codex`

Streams mocked Server-Sent Events representing Codex activity. Supported actions:

- `{"action":"run","prompt":"..."}` – emits plan/command/file-change/message events and completes the turn.
- `{"action":"theme","theme":{"primary":"#111","accent":"#f87171"}}` – acknowledges theme updates.
- `{"action":"undo"}` – indicates the latest snapshot has been restored.

Responses use `text/event-stream`. Example event payload:

```
event: plan.created
data: {"items":[{"id":"mock-thread-abc-step-1","title":"Inspect project context","status":"completed"}]}
```

In the real integration this endpoint will proxy the `@openai/codex-sdk` streaming events while enforcing the same SSE schema.

## Local Verification

- Set `OPENAI_API_KEY` in `.env.local` (mock mode still checks for it).
- `npm run lint` validates TypeScript types and ESLint rules.
- Inspect generated assets under `public/outputs/<runId>/` to confirm mock files are written correctly.

