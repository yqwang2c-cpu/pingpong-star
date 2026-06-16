import type { AnalysisResult, LeaderboardPlacement } from './analysis';

export type RootStackParamList = {
  Home: undefined;
  Record: { playerName: string };
  TargetSelect: { videoUri: string; playerName: string };
  Result: {
    playerName: string;
    result: AnalysisResult;
    leaderboardPlacement: LeaderboardPlacement;
  };
};
