import 'dotenv/config';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import OpenAI from 'openai';
import {
  FRAMES_DIR,
  cropImageAroundPoint,
  extractFrames,
  getMediaDimensions,
  getMediaInfo,
  writeHighlightImage,
} from '../utils/ffmpeg';
import {
  getCachedAnalysis,
  getHighlightPath,
  makeAnalysisKey,
  setCachedAnalysis,
  type PointSelection,
  type ScoreDimensions,
} from '../utils/persistence';

const router = Router();

function getClient(): OpenAI {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('DASHSCOPE_API_KEY is not configured');
  }

  // Qwen-VL via the OpenAI-compatible API.
  return new OpenAI({
    apiKey,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
}

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mov';
    cb(null, `video_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
});
const MAX_VIDEO_DURATION_SECONDS = 10;

// DashScope retires model aliases over time (qwen-vl-max now returns
// "Model not exist"). Keep the model configurable so the next rename is a
// one-line env change on the host instead of a code change + redeploy.
const QWEN_VL_MODEL = process.env.QWEN_VL_MODEL?.trim() || 'qwen3-vl-plus';

interface AnalyzeSession {
  id: string;
  createdAt: number;
  videoPath: string;
  videoHash: string | null;
  framePaths: string[];
  previewPath: string;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, AnalyzeSession>();

function deleteFileIfExists(filePath: string) {
  // Cleanup is best-effort. A locked, already-removed, or permission-blocked
  // temp frame must never bubble out of a `finally` block and crash the
  // process after the analysis response has already been sent.
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Could not remove a temporary analysis file:', err);
  }
}

function cleanupSession(session: AnalyzeSession) {
  deleteFileIfExists(session.videoPath);
  session.framePaths.forEach(deleteFileIfExists);
  sessions.delete(session.id);
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      cleanupSession(session);
    }
  }
}

function createSession(
  videoPath: string,
  framePaths: string[],
  videoHash: string | null
): AnalyzeSession {
  const session: AnalyzeSession = {
    id: randomUUID(),
    createdAt: Date.now(),
    videoPath,
    videoHash,
    framePaths,
    previewPath: framePaths[0],
  };
  sessions.set(session.id, session);
  return session;
}

function getSession(sessionId: string): AnalyzeSession {
  cleanupExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('The player selection session has expired. Please upload the video again.');
  }
  return session;
}

function toImageDataUrl(filePath: string): string {
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:image/jpeg;base64,${base64}`;
}

function getUploadErrorResponse(err: unknown): { statusCode: number; message: string } {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return {
          statusCode: 413,
          message: 'The video file is too large. The current limit is 200MB.',
        };
      case 'LIMIT_UNEXPECTED_FILE':
        return {
          statusCode: 400,
          message: 'Upload failed. Please make sure the form field name is "video".',
        };
      default:
        return {
          statusCode: 400,
          message: 'Video upload failed. Please try a different file.',
        };
    }
  }

  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('Invalid data found when processing input')) {
    return {
      statusCode: 400,
      message: 'This video format is not supported. Please upload a common format such as mp4 or mov.',
    };
  }

  if (message.includes('No such file or directory')) {
    return {
      statusCode: 400,
      message: 'The uploaded video could not be found or may be corrupted. Please choose it again.',
    };
  }

  if (message.includes('selection session has expired')) {
    return {
      statusCode: 404,
      message: 'The player selection session has expired. Please upload the video again.',
    };
  }

  if (message.includes('Could not extract valid frames from the video')) {
    return {
      statusCode: 400,
      message: 'We could not extract clear frames from this video. Please try a sharper clip.',
    };
  }

  if (message.includes('Please tap the player you want to analyze first')) {
    return {
      statusCode: 400,
      message: 'Please tap the player you want to analyze first.',
    };
  }

  if (message.includes('Could not determine media dimensions')) {
    return {
      statusCode: 400,
      message: 'We could not detect the video dimensions. Please try another format.',
    };
  }

  if (message.includes('Video is longer than 10 seconds')) {
    return {
      statusCode: 400,
      message: 'Videos must be 10 seconds or shorter. Please trim or record again.',
    };
  }

  if (message.includes('DASHSCOPE_API_KEY is not configured')) {
    return {
      statusCode: 503,
      message: 'The analysis service is temporarily unavailable. Please try again later.',
    };
  }

  if (message.includes('Could not extract JSON from Qwen response')) {
    return {
      statusCode: 502,
      message: 'The analysis service returned an unexpected response. Please try again.',
    };
  }

  // The OpenAI SDK wraps upstream DashScope failures in an APIError whose
  // message contains the vendor error text. Classify them so a retired model,
  // a bad key or an exhausted quota does not degrade into a vague 500.
  if (/model[_ ]not[_ ]found|model not exist|model not found/i.test(message)) {
    return {
      statusCode: 502,
      message: 'The analysis model is no longer available. Please contact the app owner.',
    };
  }

  if (/access denied|invalid api[-_ ]?key|incorrect api key|unauthorized/i.test(message)) {
    return {
      statusCode: 503,
      message: 'The analysis service is not configured correctly. Please contact the app owner.',
    };
  }

  if (/rate limit|quota|insufficient balance|throttl|timed? ?out|ETIMEDOUT/i.test(message)) {
    return {
      statusCode: 503,
      message: 'The analysis service is busy or out of quota. Please try again later.',
    };
  }

  return {
    statusCode: 500,
    message: 'Analysis failed on the server. Please try again later.',
  };
}

interface QwenAnalysis {
  score: number;
  strengths: string[];
  improvements: string[];
  highlightFrame: number;
  dimensions: ScoreDimensions | null;
  frameNotes: string[];
}

const DIMENSION_KEYS: (keyof ScoreDimensions)[] = ['stroke', 'posture', 'rotation', 'recovery'];

function buildCoachingPrompt(frameCount: number): string {
  return `You are a professional table tennis coach assessing ONE young player from ${frameCount} frames of a short practice clip. The images are in chronological order and cropped around the same player, so together they form one continuous movement sequence.

## Read the sequence before scoring
- Write one short, concrete observation for EVERY frame in "frameNotes" (exactly ${frameCount} entries, starting "Frame 1: ", "Frame 2: ", ...). Note what is actually visible: racket position, ball, torso and hip turn, knee bend, weight placement, and whether the player is preparing, making contact, following through, or recovering.
- Judge the timing dimensions by COMPARING frames. Waist rotation means hips and shoulders turning between preparation and contact. Recovery means moving back toward a ready stance in the frames AFTER contact. Never guess either from a single frame.
- Motion blur on the racket or arm is normal for a fast, powerful swing. Treat it as evidence of racket speed. NEVER score a dimension low merely because the swing is blurred.
- The frames are cropped around the player, so the ball or parts of the table may be out of view. Do not penalise a stroke for that.

## Score four dimensions independently, 0-25 each. Use the FULL range.

### stroke (0-25) - racket path and contact
0-5: no stroke, racket not visible, or an obviously incorrect swipe.
6-12: arm-only swing with no visible contact or follow-through.
13-19: recognisable stroke, visible contact, partial follow-through, one clear flaw.
20-25: clear accelerated swing, clean contact point, complete relaxed follow-through.

### posture (0-25) - stance and balance
0-5: standing straight or leaning back, no athletic stance.
6-12: slight knee bend, weight back, unstable core.
13-19: mostly stable and low, with one visible balance flaw.
20-25: knees bent, weight forward, balanced head and engaged core throughout.

### rotation (0-25) - waist and hip drive across frames
0-5: no torso change between frames, purely arm-driven.
6-12: small or late turn, shoulders and hips move together.
13-19: visible coil and uncoil with imperfect timing or range.
20-25: clear hip-led rotation transmitting power into the stroke.

### recovery (0-25) - what happens after contact
0-5: freezes in the follow-through, no reset.
6-12: starts back late and never fully resets.
13-19: returns to a ready stance but slowly or incompletely.
20-25: quick, relaxed reset to a neutral ready position.

## Calibration rules
- Score ONLY from visible evidence, using the anchors above literally. A visibly better swing MUST land in a higher band than a poorer one.
- The 20-25 band is RESERVED for technique a coach would call advanced for a junior player. Most real practice clips - including solid ones - belong in 12-19. Never place all four dimensions in 20-25 by default.
- If you name a technical flaw in "improvements", the dimension it affects CANNOT be scored in the 20-25 band. Your numbers must agree with your own written feedback.
- Spread the four scores when the evidence differs. Giving all four dimensions the same value is only acceptable if the performance really is equally strong or weak in every respect.
- Overall calibration: several visible flaws but a recognisable, complete stroke is roughly 45-65; a clearly better-than-average clip roughly 65-80; genuinely advanced technique roughly 80-95. Do not compress every clip toward a middle value, and do not inflate every clip toward a perfect score.
- If a dimension genuinely cannot be judged from these frames, give 10-14 and say so in the feedback rather than assuming the worst.
- Only a clip that is not table tennis practice at all gets 0 in every dimension.
- "strengths" and "improvements" must each cite a specific observation or frame number, not generic coaching advice. 1-3 short bullets each.
- All returned text must be English only. Never use Chinese characters.
- "highlightFrame" is the single frame that best shows the stroke (prefer ball contact); an integer from 1 to ${frameCount}.

Return valid JSON only. No markdown, no explanation, no extra text.
{
  "frameNotes": ["Frame 1: ...", "... exactly ${frameCount} strings"],
  "dimensions": {"stroke": <0-25>, "posture": <0-25>, "rotation": <0-25>, "recovery": <0-25>},
  "score": <integer, MUST equal the sum of the four dimensions>,
  "strengths": ["1-3 short English bullets citing a frame or observation"],
  "improvements": ["1-3 short English bullets citing a frame or observation"],
  "highlightFrame": <integer from 1 to ${frameCount}>
}`;
}

function parseDimensions(raw: unknown): ScoreDimensions | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const result = {} as ScoreDimensions;
  for (const key of DIMENSION_KEYS) {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) return null;
    result[key] = Math.max(0, Math.min(25, Math.round(value)));
  }
  return result;
}

function parseFrameNotes(raw: unknown, frameCount: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, frameCount);
}

function containsCjkText(value: unknown): boolean {
  return typeof value === 'string' && /[\u3400-\u9fff]/.test(value);
}

async function ensureEnglishFeedback(
  client: OpenAI,
  analysis: QwenAnalysis
): Promise<QwenAnalysis> {
  const hasNonEnglishFeedback =
    analysis.strengths.some(containsCjkText) || analysis.improvements.some(containsCjkText);

  if (!hasNonEnglishFeedback) {
    return analysis;
  }

  const translationPrompt = [
    'Rewrite the following table tennis coaching feedback into natural English.',
    'Keep the score exactly the same.',
    'Keep the JSON schema exactly the same.',
    'Return valid JSON only.',
    'Never use Chinese characters.',
    JSON.stringify({ score: analysis.score, strengths: analysis.strengths, improvements: analysis.improvements }),
  ].join('\n');

  const response = await client.chat.completions.create({
    model: QWEN_VL_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You rewrite coaching feedback into concise English JSON.',
      },
      {
        role: 'user',
        content: translationPrompt,
      },
    ],
    max_tokens: 512,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON from Qwen response');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  // Keep the computed score: the translation pass must never break the
  // invariant that score === sum(dimensions).
  return {
    ...analysis,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : analysis.strengths,
    improvements: Array.isArray(parsed.improvements)
      ? parsed.improvements
      : analysis.improvements,
  };
}

function pickHighlightFrame(raw: unknown, frameCount: number): number {
  if (frameCount <= 0) return 1;

  const fallback = Math.min(Math.max(1, Math.ceil(frameCount / 2)), frameCount);
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;

  const index = Math.round(value);
  if (index < 1 || index > frameCount) return fallback;
  return index;
}

async function analyzeWithQwen(framePaths: string[]): Promise<QwenAnalysis> {
  const client = getClient();
  type ImageUrlContent = { type: 'image_url'; image_url: { url: string } };
  type TextContent = { type: 'text'; text: string };
  type ContentItem = ImageUrlContent | TextContent;

  const imageContents: ImageUrlContent[] = framePaths.map((framePath) => {
    const base64 = fs.readFileSync(framePath).toString('base64');
    return {
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${base64}` },
    };
  });

  const content: ContentItem[] = [
    ...imageContents,
    { type: 'text', text: buildCoachingPrompt(framePaths.length) },
  ];

  const response = await client.chat.completions.create({
    model: QWEN_VL_MODEL,
    messages: [{ role: 'user', content: content as OpenAI.ChatCompletionContentPart[] }],
    // Nine frame notes plus dimension scores need more headroom than the old 1024.
    max_tokens: 2048,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('Raw Qwen response:', text);
    throw new Error('Could not extract JSON from Qwen response');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const dimensions = parseDimensions(parsed.dimensions);
  // The model's free-form total used to collapse every clip into the 50s.
  // When dimensions are present the total is computed here, never trusted.
  const score = dimensions
    ? DIMENSION_KEYS.reduce((total, key) => total + dimensions[key], 0)
    : Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));

  return ensureEnglishFeedback(client, {
    score,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    highlightFrame: pickHighlightFrame(parsed.highlightFrame, framePaths.length),
    dimensions,
    frameNotes: parseFrameNotes(parsed.frameNotes, framePaths.length),
  });
}

async function analyzeFramePaths(framePaths: string[]) {
  const analysis = await analyzeWithQwen(framePaths);
  return {
    status: 'ok',
    frames: framePaths.map((item) => path.basename(item)),
    ...analysis,
  };
}

function getFramePaths(frameNames: string[]): string[] {
  return frameNames.map((frameName) => path.join(FRAMES_DIR, path.basename(frameName)));
}

async function saveHighlight(
  analysisKey: string,
  framePaths: string[],
  highlightFrame: number | undefined
): Promise<void> {
  if (framePaths.length === 0) return;

  const fallback = Math.ceil(framePaths.length / 2);
  const requested = Number.isFinite(highlightFrame) ? Math.round(highlightFrame as number) : fallback;
  const index = Math.min(Math.max(requested, 1), framePaths.length) - 1;

  try {
    await writeHighlightImage(framePaths[index], getHighlightPath(analysisKey));
  } catch (err) {
    // A missing snapshot must never fail the analysis the player is waiting on.
    console.error('Failed to store the highlight snapshot:', err);
  }
}

async function validateVideoDuration(videoPath: string): Promise<void> {
  const mediaInfo = await getMediaInfo(videoPath);
  if (mediaInfo.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error('Video is longer than 10 seconds');
  }
}

function parseSelection(rawBody: unknown): PointSelection {
  const body = rawBody as { x?: unknown; y?: unknown };
  return {
    x: Number(body?.x),
    y: Number(body?.y),
  };
}

function isValidSelection(selection: PointSelection): boolean {
  return (
    Number.isFinite(selection.x) &&
    Number.isFinite(selection.y) &&
    selection.x >= 0 &&
    selection.x <= 1 &&
    selection.y >= 0 &&
    selection.y <= 1
  );
}

function parseVideoHash(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') return null;
  const normalized = rawValue.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) return null;
  return normalized;
}

router.post('/reuse', (req: Request, res: Response): void => {
  try {
    const videoHash = parseVideoHash(req.body?.videoHash);
    if (!videoHash) {
      res.status(400).json({ error: 'videoHash is required.' });
      return;
    }

    const selection = parseSelection(req.body);
    if (!isValidSelection(selection)) {
      res.status(400).json({ error: 'A valid selection point is required.' });
      return;
    }

    const analysisKey = makeAnalysisKey(videoHash, selection);
    const cached = getCachedAnalysis(analysisKey);
    if (!cached) {
      res.json({ reused: false });
      return;
    }

    res.json({
      reused: true,
      analysisKey,
      result: cached.result,
    });
  } catch (err) {
    console.error('Failed to look up reusable analysis:', err);
    const { statusCode, message } = getUploadErrorResponse(err);
    res.status(statusCode).json({ error: message });
  }
});

router.post('/session', (req: Request, res: Response): void => {
  cleanupExpiredSessions();

  upload.single('video')(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      console.error('Upload failed:', uploadErr);
      const { statusCode, message } = getUploadErrorResponse(uploadErr);
      res.status(statusCode).json({ error: message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No video file was received. Please use the "video" field.' });
      return;
    }

    const videoPath = req.file.path;
    const videoHash = parseVideoHash(req.body?.videoHash);
    let extractedFramePaths: string[] = [];

    try {
      await validateVideoDuration(videoPath);
      const outputPrefix = `frames_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const frames = await extractFrames(videoPath, outputPrefix);
      extractedFramePaths = getFramePaths(frames);

      if (extractedFramePaths.length === 0) {
        throw new Error('Could not extract valid frames from the video');
      }

      const session = createSession(videoPath, extractedFramePaths, videoHash);
      const previewSize = await getMediaDimensions(session.previewPath);

      res.json({
        sessionId: session.id,
        previewImage: toImageDataUrl(session.previewPath),
        previewSize,
      });
    } catch (err) {
      console.error('Failed to prepare player selection preview:', err);
      deleteFileIfExists(videoPath);
      extractedFramePaths.forEach(deleteFileIfExists);
      const { statusCode, message } = getUploadErrorResponse(err);
      res.status(statusCode).json({ error: message });
    }
  });
});

router.post('/session/:sessionId/select', async (req: Request, res: Response): Promise<void> => {
  cleanupExpiredSessions();

  try {
    const { sessionId } = req.params;
    const selection = parseSelection(req.body);

    if (!isValidSelection(selection)) {
      throw new Error('Please tap the player you want to analyze first');
    }

    const session = getSession(sessionId);
    const analysisKey = session.videoHash ? makeAnalysisKey(session.videoHash, selection) : null;
    if (analysisKey) {
      const cached = getCachedAnalysis(analysisKey);
      if (cached) {
        res.json({
          reused: true,
          analysisKey,
          ...cached.result,
        });
        return;
      }
    }

    const previewDimensions = await getMediaDimensions(session.previewPath);
    const selectedFramePaths: string[] = [];

    try {
      for (const [index, framePath] of session.framePaths.entries()) {
        const outputPath = path.join(
          FRAMES_DIR,
          `${session.id}_${Date.now()}_selected_${String(index + 1).padStart(3, '0')}.jpg`
        );
        await cropImageAroundPoint(framePath, outputPath, selection, previewDimensions);
        selectedFramePaths.push(outputPath);
      }

      const result = await analyzeFramePaths(selectedFramePaths);
      if (analysisKey) {
        setCachedAnalysis(analysisKey, result);
        await saveHighlight(analysisKey, selectedFramePaths, result.highlightFrame);
      }
      res.json({
        reused: false,
        analysisKey,
        ...result,
      });
    } finally {
      selectedFramePaths.forEach(deleteFileIfExists);
    }
  } catch (err) {
    console.error('Targeted analysis failed:', err);
    if (res.headersSent) return;
    const { statusCode, message } = getUploadErrorResponse(err);
    res.status(statusCode).json({ error: message });
  }
});

router.post('/', (req: Request, res: Response): void => {
  upload.single('video')(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      console.error('Upload failed:', uploadErr);
      const { statusCode, message } = getUploadErrorResponse(uploadErr);
      res.status(statusCode).json({ error: message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No video file was received. Please use the "video" field.' });
      return;
    }

    const videoPath = req.file.path;
    const outputPrefix = `frames_${Date.now()}`;

    console.log(`📹 Video received: ${req.file.filename} (${(req.file.size / 1024 / 1024).toFixed(1)} MB)`);

    try {
      await validateVideoDuration(videoPath);
      const frames = await extractFrames(videoPath, outputPrefix);
      console.log(`🖼️  Frames extracted: ${frames.length}. Starting Qwen-VL analysis...`);

      const framePaths = getFramePaths(frames);
      if (framePaths.length === 0) {
        throw new Error('Could not extract valid frames from the video');
      }

      const result = await analyzeFramePaths(framePaths);
      console.log(`✅ Analysis complete: score ${result.score}`);

      res.json(result);
    } catch (err) {
      console.error('Analysis failed:', err);
      const { statusCode, message } = getUploadErrorResponse(err);
      res.status(statusCode).json({ error: message });
    }
  });
});

export default router;
