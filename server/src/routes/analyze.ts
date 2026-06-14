import 'dotenv/config';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import OpenAI from 'openai';
import { extractFrames } from '../utils/ffmpeg';

const router = Router();

// 通义千问 Qwen-VL，OpenAI 兼容接口
const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

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

router.post('/', upload.single('video'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: '没有收到视频文件，请确认字段名为 video' });
    return;
  }

  const videoPath = req.file.path;
  const outputPrefix = `frames_${Date.now()}`;

  console.log(`📹 收到视频: ${req.file.filename} (${(req.file.size / 1024 / 1024).toFixed(1)} MB)`);

  try {
    const frames = await extractFrames(videoPath, outputPrefix);
    console.log(`🖼️  抽帧完成: ${frames.length} 张，开始 Qwen-VL 分析…`);

    const framesDir = path.join(__dirname, '../../frames');
    const framePaths = frames.map((f) => path.join(framesDir, path.basename(f)));

    const analysis = await analyzeWithQwen(framePaths);
    console.log(`✅ 分析完成: 得分 ${analysis.score}`);

    res.json({ status: 'ok', frames, ...analysis });
  } catch (err) {
    console.error('分析失败:', err);
    res.status(500).json({ error: '分析失败: ' + String(err) });
  }
});

export default router;
