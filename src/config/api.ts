const rawApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export const SERVER_URL = normalizeBaseUrl(
  rawApiUrl && rawApiUrl.length > 0 ? rawApiUrl : 'http://127.0.0.1:3001'
);
