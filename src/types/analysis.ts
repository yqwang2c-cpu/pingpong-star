export interface ScoreDimensions {
  stroke: number;
  posture: number;
  rotation: number;
  recovery: number;
}

export interface AnalysisResult {
  frames: string[];
  score: number;
  strengths: string[];
  improvements: string[];
  /** Only present on results produced by the v2 per-dimension rubric. */
  dimensions?: ScoreDimensions | null;
  frameNotes?: string[];
}

export interface AnalyzeSessionPreview {
  sessionId: string;
  previewImage: string;
  previewSize: {
    width: number;
    height: number;
  };
}

export interface PersonalStanding {
  isPersonalBest: boolean;
  personalBestScore: number;
  personalRank: number;
  personalTotal: number;
  pointsToBest: number;
}

export interface LeaderboardPlacement {
  qualified: boolean;
  rank: number | null;
  celebrate?: boolean;
  personal?: PersonalStanding | null;
}
