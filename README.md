# Building Stories

Builder is a Next.js App Router project that lets you upload a sketch, generate GPT‑Image references, and request a Sora clip from the same run. API routes under `app/api/` talk directly to OpenAI (images + videos) and power the in-app Codex agent.

## Requirements

- Node.js 20+
- `OPENAI_API_KEY` available to the Next.js runtime

Install dependencies once:

```bash
npm install
```

## Commands

| Script | Description |
| --- | --- |
| `npm run dev` | Start the local dev server at http://localhost:3000 |
| `npm run build` | Create the production bundle |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint with the Next.js preset |

## Development Notes

- Image/video outputs are written to `public/outputs/<runId>` so the UI can fetch them without extra storage.
- The Codex sidebar streams runs through `/api/codex/*`; refer to `app/components/SidePanel.tsx` for the client flow.
- For more detailed API contracts or history, see the files in `docs/`.
