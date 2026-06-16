export interface AnalysisResult {
  frames: string[];
  score: number;
  strengths: string[];
  improvements: string[];
}

export interface AnalyzeSessionPreview {
  sessionId: string;
  previewImage: string;
  previewSize: {
    width: number;
    height: number;
  };
}

export interface LeaderboardPlacement {
  qualified: boolean;
  rank: number | null;
}
