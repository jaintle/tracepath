import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import os from 'os';
import fetch from 'node-fetch';

const app = express();
app.use(cors());

app.get('/trace', (req, res) => {
  const target = req.query.target || 'openai.com';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const trace = spawn('tracert', ['-h', '6', target]);
  let hopIndex = 0;

  trace.stdout.on('data', async (data) => {
    const lines = data.toString().split(/\r?\n/).filter(line => line.trim());

    for (const line of lines) {
      const ipMatch = line.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
      if (!ipMatch) continue;

      const ip = ipMatch[0];
      try {
        const geo = await fetch(`http://ip-api.com/json/${ip}`).then(r => r.json());

        const hopData = {
          hop: ++hopIndex,
          ip,
          city: geo.city,
          country: geo.country,
          lat: geo.lat,
          lon: geo.lon,
          org: geo.org
        };

        res.write(`data: ${JSON.stringify(hopData)}\n\n`);
      } catch (err) {
        res.write(`data: {"hop": ${++hopIndex}, "ip": "${ip}", "error": "geo lookup failed"}\n\n`);
      }
    }
  });

  trace.on('close', () => {
    res.write(`event: end\ndata: done\n\n`);
    res.end();
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
