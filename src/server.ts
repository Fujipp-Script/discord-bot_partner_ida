// src/server.ts
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.get('/', (_req, res) => res.send('Bot is running ✅'));
app.get('/healthz', (_req, res) => res.json({ ok: true, t: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`🌐 Health server listening on :${PORT}`);
});
