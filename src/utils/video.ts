import * as ImagePicker from 'expo-image-picker';

type PickVideoResult =
  | { status: 'picked'; asset: ImagePicker.ImagePickerAsset }
  | { status: 'cancelled' }
  | { status: 'permission_denied' };

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

  return { status: 'picked', asset: picked.assets[0] };
}
