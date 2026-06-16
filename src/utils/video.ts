import * as ImagePicker from 'expo-image-picker';

export const MAX_VIDEO_DURATION_SECONDS = 10;
export const MAX_VIDEO_DURATION_MS = MAX_VIDEO_DURATION_SECONDS * 1000;

type PickVideoResult =
  | { status: 'picked'; asset: ImagePicker.ImagePickerAsset }
  | { status: 'too_long'; durationMs: number }
  | { status: 'cancelled' }
  | { status: 'permission_denied' };

export function getVideoDurationLimitMessage(): string {
  return `Videos must be ${MAX_VIDEO_DURATION_SECONDS} seconds or shorter. Please choose another clip.`;
}

export function inferVideoMimeType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'avi':
      return 'video/x-msvideo';
    default:
      return 'application/octet-stream';
  }
}

export async function pickVideoFromLibrary(): Promise<PickVideoResult> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    return { status: 'permission_denied' };
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    allowsEditing: false,
    quality: 1,
  });

  if (picked.canceled || !picked.assets[0]) {
    return { status: 'cancelled' };
  }

  const durationMs = picked.assets[0].duration ?? 0;
  if (durationMs > MAX_VIDEO_DURATION_MS) {
    return { status: 'too_long', durationMs };
  }

  return { status: 'picked', asset: picked.assets[0] };
}
