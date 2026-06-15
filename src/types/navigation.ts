import type { AnalysisResult } from './analysis';

export type RootStackParamList = {
  Home: undefined;
  Record: { playerName: string };
  TargetSelect: { videoUri: string; playerName: string };
  Result: { playerName: string; result: AnalysisResult };
};
