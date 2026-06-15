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
    throw new Error('DASHSCOPE_API_KEY 未配置');
  }

  // 通义千问 Qwen-VL，OpenAI 兼容接口
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
    throw new Error('选人会话不存在或已过期，请重新上传视频');
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
          message: '视频文件过大，当前最大支持 200MB，请压缩后重试',
        };
      case 'LIMIT_UNEXPECTED_FILE':
        return {
          statusCode: 400,
          message: '上传失败，请确认表单字段名为 video',
        };
      default:
        return {
          statusCode: 400,
          message: '视频上传失败，请更换文件后重试',
        };
    }
  }

  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('Invalid data found when processing input')) {
    return {
      statusCode: 400,
      message: '无法识别该视频格式，请上传 mp4、mov 等常见视频文件',
    };
  }

  if (message.includes('No such file or directory')) {
    return {
      statusCode: 400,
      message: '上传的视频文件不存在或已损坏，请重新选择后重试',
    };
  }

  if (message.includes('选人会话不存在或已过期')) {
    return {
      statusCode: 404,
      message: '选人会话已失效，请重新上传视频',
    };
  }

  if (message.includes('未能从视频中提取有效截图')) {
    return {
      statusCode: 400,
      message: '无法从这个视频中提取有效画面，请更换更清晰的视频后重试',
    };
  }

  if (message.includes('请先点击要评分的球员')) {
    return {
      statusCode: 400,
      message: '请先点击要评分的球员',
    };
  }

  if (message.includes('无法识别媒体尺寸')) {
    return {
      statusCode: 400,
      message: '无法识别视频画面尺寸，请更换视频格式后重试',
    };
  }

  if (message.includes('视频时长超过 10 秒')) {
    return {
      statusCode: 400,
      message: '视频时长不能超过 10 秒，请重新录制或裁剪后再试',
    };
  }

  if (message.includes('DASHSCOPE_API_KEY 未配置')) {
    return {
      statusCode: 503,
      message: '服务器分析能力暂不可用，请稍后再试',
    };
  }

  if (message.includes('无法从 Qwen 响应中提取 JSON')) {
    return {
      statusCode: 502,
      message: '分析服务返回异常，请稍后重试',
    };
  }

  return {
    statusCode: 500,
    message: '服务器分析失败，请稍后重试',
  };
}

const COACHING_PROMPT = `你是严格的乒乓球专业教练，正在评估一段小学生练球视频的截图序列。你的评分标准极为严格，目的是帮助孩子找到真实不足。

## 评分维度（每项 0-25 分）

### 1. 接球动作（0-25）
- 0-5 分：动作完全错误，或看不到挥拍
- 6-12 分：有挥拍但幅度不足，正手未到头顶，或反手手腕明显弯曲
- 13-19 分：基本正确但细节有瑕疵
- 20-25 分：正手清晰挥到头顶且舒展，或反手手腕完全固定

### 2. 身体姿态（0-25）
- 0-5 分：站直或向后仰，没有蹲马步
- 6-12 分：稍微弯腰但核心不稳，重心偏后
- 13-19 分：姿态基本稳定，偶有后仰
- 20-25 分：全程蹲稳，重心始终在前，核心收紧

### 3. 腰部转动（0-25）
- 0-5 分：腰完全不转，只动手臂
- 6-12 分：有转动但幅度过大（拍子转到背后）或幅度过小
- 13-19 分：腰部转动参与发力，范围基本合理
- 20-25 分：腰部带动手臂，转动流畅且控制在合理范围内

### 4. 复位（0-25）
- 0-5 分：击球后僵在原地不动
- 6-12 分：有复位意识但动作慢，超过 1 秒才恢复
- 13-19 分：基本及时复位
- 20-25 分：击球后立即弹回中立站位，衔接流畅

## 严格评估原则
- **默认给低分**：动作"还行"不等于正确，必须清晰、标准才能进入中高分段
- **看不到 = 不存在**：截图中无法判断某动作是否完成，该维度按 0-5 分处理
- **60 分是及格线**：普通初学者的正常水平应在 40-55 分，只有动作明显标准的才能及格
- 如果图片中无乒乓球相关场景，所有维度均为 0

请严格以如下 JSON 格式返回，不要输出任何其他内容：
{
  "score": <0-100 的整数，4个维度之和>,
  "strengths": ["做得好的具体点，若无亮点则填'暂无明显亮点'"],
  "improvements": ["最需要改进的具体点，1-3 条，要具体指出问题动作"]
}`;

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
    console.error('Qwen 原始返回:', text);
    throw new Error('无法从 Qwen 响应中提取 JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score)))),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
  };
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
    throw new Error('视频时长超过 10 秒');
  }
}

router.post('/session', (req: Request, res: Response): void => {
  cleanupExpiredSessions();

  upload.single('video')(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      console.error('上传失败:', uploadErr);
      const { statusCode, message } = getUploadErrorResponse(uploadErr);
      res.status(statusCode).json({ error: message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: '没有收到视频文件，请确认字段名为 video' });
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
        throw new Error('未能从视频中提取有效截图');
      }

      const session = createSession(videoPath, extractedFramePaths);
      const previewSize = await getMediaDimensions(session.previewPath);

      res.json({
        sessionId: session.id,
        previewImage: toImageDataUrl(session.previewPath),
        previewSize,
      });
    } catch (err) {
      console.error('准备选人预览失败:', err);
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
      throw new Error('请先点击要评分的球员');
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
    console.error('定向分析失败:', err);
    const { statusCode, message } = getUploadErrorResponse(err);
    res.status(statusCode).json({ error: message });
  }
});

router.post('/', (req: Request, res: Response): void => {
  upload.single('video')(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      console.error('上传失败:', uploadErr);
      const { statusCode, message } = getUploadErrorResponse(uploadErr);
      res.status(statusCode).json({ error: message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: '没有收到视频文件，请确认字段名为 video' });
      return;
    }

    const videoPath = req.file.path;
    const outputPrefix = `frames_${Date.now()}`;

    console.log(`📹 收到视频: ${req.file.filename} (${(req.file.size / 1024 / 1024).toFixed(1)} MB)`);

    try {
      await validateVideoDuration(videoPath);
      const frames = await extractFrames(videoPath, outputPrefix);
      console.log(`🖼️  抽帧完成: ${frames.length} 张，开始 Qwen-VL 分析…`);

      const framePaths = getFramePaths(frames);
      if (framePaths.length === 0) {
        throw new Error('未能从视频中提取有效截图');
      }

      const result = await analyzeFramePaths(framePaths);
      console.log(`✅ 分析完成: 得分 ${result.score}`);

      res.json(result);
    } catch (err) {
      console.error('分析失败:', err);
      const { statusCode, message } = getUploadErrorResponse(err);
      res.status(statusCode).json({ error: message });
    }
  });
});

export default router;
