import express from 'express';
import cors from 'cors';
import analyzeRouter from './routes/analyze';
import scoresRouter from './routes/scores';
import { runNameNormalizationMigration } from './utils/nameMigration';
import { runScoreReset } from './utils/scoreReset';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'PingPong Star backend is running.' });
});

app.use('/api/analyze', analyzeRouter);
app.use('/api/scores', scoresRouter);

runScoreReset();
runNameNormalizationMigration();

app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Analysis endpoint: POST http://localhost:${PORT}/api/analyze`);
  console.log(`   Score endpoint: GET/POST http://localhost:${PORT}/api/scores`);
});
