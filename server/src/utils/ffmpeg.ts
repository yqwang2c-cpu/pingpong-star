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

/** Frames handed to the vision model. Enough to cover preparation -> contact -> follow-through -> recovery. */
export const ANALYSIS_FRAME_COUNT = 9;

export async function extractFrames(videoPath: string, outputPrefix: string): Promise<string[]> {
  ensureFramesDir();

  // Sample evenly across the WHOLE clip. A fixed `fps=1, frames=6` only ever
  // showed the first few seconds (and just 3 frames for a typical 3s clip),
  // which made waist rotation and recovery impossible to judge and silently
  // dropped the tail of any longer video.
  const info = await getMediaInfo(videoPath);
  const duration = Math.max(
    0.8,
    Math.min(info.durationSeconds > 0 ? info.durationSeconds : 8, 10)
  );
  const fps = ANALYSIS_FRAME_COUNT / duration;
  const outputPattern = path.join(FRAMES_DIR, `${outputPrefix}_%03d.jpg`);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-vf', `fps=${fps.toFixed(3)},scale=1280:-1`,
        '-frames:v', String(ANALYSIS_FRAME_COUNT),
      ])
      .output(outputPattern)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });

  const frames: string[] = [];
  for (let i = 1; i <= ANALYSIS_FRAME_COUNT; i++) {
    const filename = `${outputPrefix}_${String(i).padStart(3, '0')}.jpg`;
    if (fs.existsSync(path.join(FRAMES_DIR, filename))) {
      frames.push(filename);
    }
  }
  return frames;
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
        reject(new Error('Could not determine media dimensions'));
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
        reject(new Error('Could not determine media dimensions'));
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

export function writeHighlightImage(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    ffmpeg(inputPath)
      .outputOptions(['-vf', 'scale=720:-1', '-q:v', '6', '-frames:v', '1'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
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
