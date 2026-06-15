import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

const configuredFfmpegPath = process.env.FFMPEG_PATH?.trim();
if (configuredFfmpegPath) {
  ffmpeg.setFfmpegPath(configuredFfmpegPath);
}

export const FRAMES_DIR = path.join(__dirname, '../../frames');

export interface MediaDimensions {
  width: number;
  height: number;
}

export interface MediaInfo {
  width: number;
  height: number;
  durationSeconds: number;
}

function ensureFramesDir() {
  if (!fs.existsSync(FRAMES_DIR)) {
    fs.mkdirSync(FRAMES_DIR, { recursive: true });
  }
}

export function extractFrames(videoPath: string, outputPrefix: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    ensureFramesDir();

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

export function getMediaDimensions(filePath: string): Promise<MediaDimensions> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const stream = metadata.streams.find((item) => item.width && item.height);
      if (!stream?.width || !stream?.height) {
        reject(new Error('无法识别媒体尺寸'));
        return;
      }

      resolve({ width: stream.width, height: stream.height });
    });
  });
}

export function getMediaInfo(filePath: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const stream = metadata.streams.find((item) => item.width && item.height);
      if (!stream?.width || !stream?.height) {
        reject(new Error('无法识别媒体尺寸'));
        return;
      }

      const durationFromFormat = Number(metadata.format?.duration ?? 0);
      const durationFromStream = Number((stream as { duration?: number | string }).duration ?? 0);
      const durationSeconds = durationFromFormat > 0 ? durationFromFormat : durationFromStream;

      resolve({
        width: stream.width,
        height: stream.height,
        durationSeconds,
      });
    });
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function cropImageAroundPoint(
  inputPath: string,
  outputPath: string,
  selection: { x: number; y: number },
  dimensions: MediaDimensions
): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureFramesDir();

    const cropWidth = Math.min(dimensions.width, Math.max(260, Math.round(dimensions.width * 0.45)));
    const cropHeight = Math.min(dimensions.height, Math.max(360, Math.round(dimensions.height * 0.8)));
    const centerX = Math.round(selection.x * dimensions.width);
    const centerY = Math.round(selection.y * dimensions.height);
    const cropX = clamp(centerX - Math.round(cropWidth / 2), 0, Math.max(0, dimensions.width - cropWidth));
    const cropY = clamp(centerY - Math.round(cropHeight / 2), 0, Math.max(0, dimensions.height - cropHeight));
    const filter = `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY},scale=960:-1`;

    ffmpeg(inputPath)
      .outputOptions(['-vf', filter, '-frames:v', '1'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}
