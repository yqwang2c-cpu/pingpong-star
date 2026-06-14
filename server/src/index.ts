import express from 'express';
import cors from 'cors';
import analyzeRouter from './routes/analyze';
import scoresRouter from './routes/scores';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: '乒乓之星后端运行中 🏓' });
});

app.use('/api/analyze', analyzeRouter);
app.use('/api/scores', scoresRouter);

app.listen(PORT, () => {
  console.log(`🚀 服务器启动: http://localhost:${PORT}`);
  console.log(`   健康检查: http://localhost:${PORT}/health`);
  console.log(`   分析接口: POST http://localhost:${PORT}/api/analyze`);
  console.log(`   排行榜接口: GET/POST http://localhost:${PORT}/api/scores`);
});
