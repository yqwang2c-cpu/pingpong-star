# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> Note on the AGENTS.md directive: it points to the Expo **v56** docs, but `package.json` pins **Expo SDK ~54** (`expo: ~54.0.0`, RN 0.81, React 19.1). Always read the docs matching the **actually installed SDK** (https://docs.expo.dev/versions/v54.0.0/ for this repo) before writing Expo code — the v56 link in AGENTS.md appears to be aspirational, not the pinned version.

## What this is

A kids' table-tennis coaching app. The user records (≤10 s, in-app camera) or uploads a short video, taps the player in a preview frame, and the backend returns a 0–100 score plus strengths/improvements from a vision model. Top-5 leaderboard with fireworks on the result screen.

## Commands

No tests, no lint, no CI are configured — the only scripts are the ones below.

### App (repo root)
```bash
npm start                 # expo start (Metro)
npm run android           # expo start --android
npm run ios               # expo start --ios
npx tsc --noEmit          # typecheck only (tsconfig extends expo/tsconfig.base, strict)
```

### Backend (`server/`, Express + TypeScript)
```bash
cd server
npm run dev               # ts-node-dev --respawn src/index.ts → http://localhost:3001, GET /health
npm run build             # tsc → dist/
npm start                 # node dist/index.js
```
Requires `DASHSCOPE_API_KEY` in `server/.env` (Alibaba Qwen-VL via the OpenAI-compatible endpoint `https://dashscope.aliyuncs.com/compatible-mode/v1`). Without it, analysis routes return 503.

### Deploy
- Backend: Render Blueprint via root `render.yaml` + `server/Dockerfile`. Persists scores on a mounted disk at `/var/data/scores.json` (`SCORES_FILE` env override). Full steps in `DEPLOY_APK.md`.
- Android APK: `npx eas build --platform android --profile preview` (or `--local`). Profiles `preview-arm64` / `preview-armv7` set `ANDROID_BUILD_ARCHS` for ABI-split builds; `app.config.js` reads that env var and pushes `expo-build-properties` — keep that wiring intact.
- Point the app at a deployed backend by setting `EXPO_PUBLIC_API_URL` in the root `.env` (see `.env.example`). `src/config/api.ts` falls back to `https://pingpong-star-server.onrender.com` when unset.

## Architecture

### Client (Expo / RN, `src/`)
Four-screen stack (`App.tsx`, React Navigation v7, no headers):
**Home → Record → TargetSelect → Result** (see `src/types/navigation.ts`).

- `HomeScreen` — fetches `GET /api/scores`, vertical top-5 list (one row per player, holding their best score). Tapping a row that has a `highlightUrl` opens a snapshot card with that clip's best moment. The hero card is itself the primary action, and a name modal (family/given fields, forced to capitals) gates both Record and Upload flows; `playerName` then travels through nav params to the Result screen and the score POST.
- `RecordScreen` — `expo-camera` `recordAsync({ maxDuration: 10 })`. Upload path instead uses `expo-image-picker` (`src/utils/video.ts` enforces the same 10 s cap).
- `TargetSelectScreen` — the orchestration hub. Flow on entry:
  1. `getVideoMd5(videoUri)` → try `POST /api/analyze/reuse` (server-side cache hit skips re-analysis entirely).
  2. Else check local file cache `getCachedAnalysis(makeCacheKey(md5, point))` (`src/utils/analysisCache.ts`, max 40 entries, `{md5}:{x*1000}:{y*1000}` keys).
  3. Else `POST /api/analyze/session` (multipart) → get `{sessionId, previewImage, previewSize}`.
  4. Auto-analyzes at center point `{0.5, 0.5}` after ~650 ms if the user doesn't tap; a tap converts to normalized 0–1 coords and auto-submits after a 220 ms debounce via `POST /api/analyze/session/:id/select`.
  5. Saves score (`POST /api/scores` with `analysisKey` for dedupe), caches by `analysisKey`, `navigation.replace('Result', …)`.
- `ResultScreen` — animated score counter; fireworks only when `leaderboardPlacement.qualified && celebrate !== false`.

All animation uses Reanimated 4 / worklets / gesture-handler — `react-native-gesture-handler` is imported first in `App.tsx`; keep it that way.

### Backend (`server/src/`)
- `index.ts` — mounts `/api/analyze` and `/api/scores`; `/health` for Render.
- `routes/analyze.ts` — the analysis pipeline:
  - `POST /session` — multer upload (200 MB cap, field name `video`) → `fluent-ffmpeg` validates duration ≤10 s and extracts frames → returns a session id + first frame as a data-URL preview. Sessions live in an in-memory `Map` with a 30-min TTL; files under `server/uploads/` and `server/frames/` are cleaned up with the session.
  - `POST /session/:id/select` — crops every extracted frame around the tapped normalized point, sends the crops to **qwen-vl-max** with a strict coaching rubric (4 × 0–25 dimensions: stroke mechanics, body posture, waist rotation, recovery), parses JSON out of the reply, and forces English via a rewrite pass if CJK chars slip in (`ensureEnglishFeedback`). The model also returns `highlightFrame` (1-based index of the clearest stroke); that crop is scaled to 720 px and kept in the highlights dir as the clip's snapshot. Falls back to the middle frame when the value is missing or out of range. Result is cached server-side by `analysisKey = {videoHash}:{pointKey}`.
  - `POST /reuse` — pure cache lookup; lets the client skip the upload entirely on identical video+point.
  - `POST /` — legacy single-shot upload+analyze (no session/tap); kept for compatibility.
  - `getUploadErrorResponse` maps ffmpeg/multer/error-message substrings to status codes and user-facing copy — new failure modes should be added there, not as ad-hoc `res.status(500)` calls.
- `routes/scores.ts` — `GET /` returns top-5 (ties share a rank), each row carrying a `highlightUrl` when a snapshot exists for it; `GET /highlight/:entryId` streams that JPEG. `POST /` accepts optional `playerId` / `accountId` and calls `saveScoreOnce`, which dedupes on `{identityKey}:{analysisKey}` so re-submitting the same analysis for the same child never double-posts.
- `utils/scoreReset.ts` — one-time boot step that empties the scores file, flagged by `.scores-cleared-v1`. It exists because records written before snapshots cannot show a best moment.
- `utils/legacyScoreReset.ts` — drops records written before player accounts existed (no `playerId`), including their snapshots. Opt-in via `CLEAR_LEGACY_SCORES=true` and one-shot via `.scores-cleared-v2`; anything already filed under a profile is kept. Flip it on the deploy that ships accounts, not before.
- `utils/persistence.ts` — JSON-file storage. **A record's identity is `playerId ?? nameKey`** (`playerIdentityKey`), so two children with the same name rank separately once they have profiles, while records written before accounts still group by name. `SCORES_FILE` env var wins; on Render it resolves to `/var/data/scores.json` when that mount exists, else `server/scores.json`. Analysis cache lives next to it as `analysis-cache.json`. **Data does not survive a redeploy unless the disk is mounted** — noted in `DEPLOY_APK.md`.

## Gotchas

- **Two caches, two key formats.** Client cache (`src/utils/analysisCache.ts`) and server cache (`utils/persistence.ts`) both key on `md5:point`, but the client computes md5 itself via `expo-file-system` and sends it as `videoHash`. If you change one key format, change both, and remember `makeAnalysisKey` on the server lowercases/normalizes the hash.
- The repo root is littered with EAS-CLI debugging artifacts (`query*.json`, `introspect*.js`, `eas-cli-*.tgz`, `.eas-*`, `expo_home/`, `apollo*.json`, `monetization-architecture/`, …). They're untracked scratch — don't treat them as app code, and don't `git add` them blindly.
- `.easignore` excludes `server/`, `**/*.md`, and the cache dirs from EAS uploads; keep server-only files out of the app bundle.
- Video duration is enforced in three places: camera `maxDuration`, image-picker result check in `src/utils/video.ts`, and server-side ffprobe in `validateVideoDuration`. Keep all three at 10 s.
