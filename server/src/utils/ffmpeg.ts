import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

const configuredFfmpegPath = process.env.FFMPEG_PATH?.trim();
if (configuredFfmpegPath) {
  ffmpeg.setFfmpegPath(configuredFfmpegPath);
}

const FRAMES_DIR = path.join(__dirname, '../../frames');

export function extractFrames(videoPath: string, outputPrefix: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FRAMES_DIR)) {
      fs.mkdirSync(FRAMES_DIR, { recursive: true });
    }

    const outputPattern = path.join(FRAMES_DIR, `${outputPrefix}_%03d.jpg`);

    ffmpeg(videoPath)
      .outputOptions([
        '-vf', 'fps=1,scale=1280:-1',  // 每秒取1帧，宽度降到1280节省 API 费用
        '-frames:v', '6',               // 最多取6张
      ])
      .output(outputPattern)
      .on('end', () => {
        // 找出生成的帧文件
        const frames: string[] = [];
        for (let i = 1; i <= 6; i++) {
          const filename = `${outputPrefix}_${String(i).padStart(3, '0')}.jpg`;
          const fullPath = path.join(FRAMES_DIR, filename);
          if (fs.existsSync(fullPath)) {
            frames.push(filename);
          }
        }
        resolve(frames);
      })
      .on('error', reject)
      .run();
  });
}
