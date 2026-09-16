export const colors = {
  primary: '#FF6B2C',
  primarySoft: '#FF9066',
  primaryTint: '#FFE3D3',
  primaryHairline: '#FFD9BF',

  gold: '#FFC53D',
  silver: '#CBD5E1',
  bronze: '#E8A87C',
  neutral: '#F5E6DA',

  success: '#16A34A',
  successTint: '#DCFCE7',

  canvas: '#FFF7ED',
  surface: '#FFFFFF',
  ink: '#2B2119',
  body: '#6B5B4B',
  muted: '#A08B78',
  hairline: '#F0E2D6',
  danger: '#E24B4A',

  camera: '#0F2417',
  onCamera: '#FFFFFF',
};

export const radius = {
  small: 12,
  medium: 16,
  large: 20,
  xlarge: 24,
  pill: 999,
};

export const fontSize = {
  hero: 52,
  display: 34,
  title: 24,
  card: 17,
  button: 15,
  body: 14,
  caption: 12,
  micro: 11,
  label: 10,
};

export const space = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
};

export const MAX_SCORE = 100;

export function rankColor(rank: number): string {
  if (rank === 1) return colors.gold;
  if (rank === 2) return colors.silver;
  if (rank === 3) return colors.bronze;
  return colors.neutral;
}

export function rankTextColor(rank: number): string {
  if (rank === 1) return '#7A4A00';
  if (rank === 2) return '#475569';
  if (rank === 3) return '#7A3C10';
  return colors.muted;
}

/** Players to show on the leaderboard */
export const LEADERBOARD_SIZE = 5;
