# Building Stories

Builder is a Next.js App Router project that lets you upload a sketch, generate GPT‑Image references, and request a Sora clip from the same run. API routes under `app/api/` talk directly to OpenAI (images + videos) and power the in-app Codex agent.

## Demo Recording

![Codex Demo – DDX 2025 Seoul](docs/Codex%20Demo%20-%20DDX%202025%20Seoul.gif)

- The GIF above (`docs/Codex Demo - DDX 2025 Seoul.gif`) is a quick capture of the demo walkthrough. Watch the [full-length recording](https://drive.google.com/file/d/16X7p0tSB6riMvHvW1KfGnM6mE3GxvEuU/view) for every interaction and narration beat.

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

## Codex Cloud Best-of-N

Use the following sample prompt when configuring a Codex Cloud best-of-N task (adjust `N` and any fields to match your run):

```text
Please make the UI of this app look fun and cute. The app lets a user upload a photo, then the AI makes an image, and then it makes a video. If the video step fails, the app can load an older video.
Right now the UI looks boring. Please restyle it so it looks awesome. You can use a kid-friendly theme or pastel colors. Choose a style and use the same colors everywhere.
The screen layout should be like this:
- On the right side, there is a helper bar. It is small at first and can open to show AI tools that can change the website.
- The rest of the screen is the main app.
Inside the main app:
- The top row shows the uploaded photo and a multiline text box for the image prompt.
- The second row shows the 5 AI-generated images.
- The bottom row has a multiline text box for the video prompt and a video player.
Please make the whole layout look simple, friendly, and fun for kids.
Please also take screenshots before, during, and after making changes.
```

- Example output from this prompt (best-of-N run): [chatgpt.com/codex/tasks/task_i_691bdafae1cc8325bfc7675b8389e507](https://chatgpt.com/codex/tasks/task_i_691bdafae1cc8325bfc7675b8389e507)
