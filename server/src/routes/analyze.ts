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
} from '../utils/ffmpeg';

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

interface AnalyzeSession {
  id: string;
  createdAt: number;
  videoPath: string;
  framePaths: string[];
  previewPath: string;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, AnalyzeSession>();

function deleteFileIfExists(filePath: string) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
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

function createSession(videoPath: string, framePaths: string[]): AnalyzeSession {
  const session: AnalyzeSession = {
    id: randomUUID(),
    createdAt: Date.now(),
    videoPath,
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

  return {
    statusCode: 500,
    message: 'Analysis failed on the server. Please try again later.',
  };
}

const COACHING_PROMPT = `You are a strict professional table tennis coach reviewing a sequence of frames from a young student's practice video. Score strictly so the child gets honest, actionable feedback.

## Scoring dimensions (0-25 points each)

### 1. Stroke mechanics (0-25)
- 0-5: The stroke is clearly incorrect, or the swing cannot be seen.
- 6-12: A swing exists but is incomplete. Forehand does not reach up well, or backhand wrist is visibly bent.
- 13-19: Mostly correct with noticeable technical flaws.
- 20-25: Clear, relaxed, technically sound stroke. Forehand reaches high; backhand wrist stays stable.

### 2. Body posture (0-25)
- 0-5: Standing upright or leaning backward, without an athletic stance.
- 6-12: Slight bend only, unstable core, weight too far back.
- 13-19: Mostly stable posture with occasional balance issues.
- 20-25: Low, balanced stance throughout, weight forward, core engaged.

### 3. Waist rotation (0-25)
- 0-5: No waist rotation, mostly arm-only motion.
- 6-12: Some rotation but either too large or too small.
- 13-19: Waist rotation helps generate power and is mostly controlled.
- 20-25: Smooth, efficient waist-driven motion with strong control.

### 4. Recovery (0-25)
- 0-5: Freezes after contact and does not recover.
- 6-12: Tries to recover but slowly, taking more than one second.
- 13-19: Usually recovers in time.
- 20-25: Quickly returns to a neutral ready position after each stroke.

## Strict evaluation rules
- Default to lower scores. "Looks okay" is not enough for a medium or high score.
- If you cannot clearly see a movement, assume it is not done well and score 0-5 in that area.
- 60 is a passing score. A normal beginner should often score around 40-55. Only clearly solid technique should pass.
- If the frames do not show a table tennis practice scene, give 0 in every dimension.
- All returned text must be English only.
- Never use Chinese characters in strengths or improvements.

Return valid JSON only. No markdown, no explanation, no extra text.
{
  "score": <integer from 0 to 100, sum of the four dimensions>,
  "strengths": ["1-3 short English bullet points about what was done well. Use 'No clear strengths yet' if needed."],
  "improvements": ["1-3 short English bullet points describing the most important technical fixes."]
}`;

function containsCjkText(value: unknown): boolean {
  return typeof value === 'string' && /[\u3400-\u9fff]/.test(value);
}

async function ensureEnglishFeedback(
  client: OpenAI,
  analysis: {
    score: number;
    strengths: string[];
    improvements: string[];
  }
): Promise<{
  score: number;
  strengths: string[];
  improvements: string[];
}> {
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
    JSON.stringify(analysis),
  ].join('\n');

  const response = await client.chat.completions.create({
    model: 'qwen-vl-max',
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
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? analysis.score)))),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : analysis.strengths,
    improvements: Array.isArray(parsed.improvements)
      ? parsed.improvements
      : analysis.improvements,
  };
}

async function analyzeWithQwen(framePaths: string[]): Promise<{
  score: number;
  strengths: string[];
  improvements: string[];
}> {
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
    { type: 'text', text: COACHING_PROMPT },
  ];

  const response = await client.chat.completions.create({
    model: 'qwen-vl-max',
    messages: [{ role: 'user', content: content as OpenAI.ChatCompletionContentPart[] }],
    max_tokens: 1024,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('Raw Qwen response:', text);
    throw new Error('Could not extract JSON from Qwen response');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return ensureEnglishFeedback(client, {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score)))),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
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

async function validateVideoDuration(videoPath: string): Promise<void> {
  const mediaInfo = await getMediaInfo(videoPath);
  if (mediaInfo.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error('Video is longer than 10 seconds');
  }
}

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
    let extractedFramePaths: string[] = [];

    try {
      await validateVideoDuration(videoPath);
      const outputPrefix = `frames_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const frames = await extractFrames(videoPath, outputPrefix);
      extractedFramePaths = getFramePaths(frames);

      if (extractedFramePaths.length === 0) {
        throw new Error('Could not extract valid frames from the video');
      }

      const session = createSession(videoPath, extractedFramePaths);
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
    const selection = {
      x: Number(req.body?.x),
      y: Number(req.body?.y),
    };

    if (
      !Number.isFinite(selection.x) ||
      !Number.isFinite(selection.y) ||
      selection.x < 0 ||
      selection.x > 1 ||
      selection.y < 0 ||
      selection.y > 1
    ) {
      throw new Error('Please tap the player you want to analyze first');
    }

    const session = getSession(sessionId);
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
      res.json(result);
    } finally {
      selectedFramePaths.forEach(deleteFileIfExists);
    }
  } catch (err) {
    console.error('Targeted analysis failed:', err);
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
