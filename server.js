const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use(express.static(__dirname));

// Explicit root route fallback
app.get('/', (req, res) => {
  const publicIndex = path.join(publicDir, 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');

  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }
  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }
  res.status(404).send('index.html not found in /public or root directory.');
});

const state = {
  bands: [],
  memories: [],
  counts: {
    Joy: 0,
    Peace: 0,
    Love: 0,
    Grief: 0,
    Passion: 0,
    Anxiety: 0,
    Hope: 0
  }
};

const MAX_BANDS = 180;
const MAX_MEMORIES = 120;

io.on('connection', (socket) => {
  socket.emit('init_state', {
    ...state,
    onlineCount: io.engine.clientsCount
  });

  io.emit('online_count', io.engine.clientsCount);

  socket.on('paint_emotion', (payload) => {
    if (!payload || !payload.emotion || !payload.color) return;
    const emotion = String(payload.emotion).slice(0, 24);
    const color = String(payload.color).slice(0, 16);

    if (Object.prototype.hasOwnProperty.call(state.counts, emotion)) {
      state.counts[emotion] += 1;
    }

    const band = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      emotion,
      color,
      timestamp: Date.now()
    };

    state.bands.push(band);
    if (state.bands.length > MAX_BANDS) state.bands.shift();

    io.emit('emotion_painted', { band, counts: state.counts });
  });

  socket.on('add_memory', (payload) => {
    if (!payload || typeof payload.text !== 'string') return;
    const cleanText = payload.text.trim().slice(0, 280);
    if (!cleanText) return;

    const emotion = String(payload.emotion || 'Hope').slice(0, 24);
    const color = String(payload.color || '#38bdf8').slice(0, 16);

    if (Object.prototype.hasOwnProperty.call(state.counts, emotion)) {
      state.counts[emotion] += 1;
    }

    const memory = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      text: cleanText,
      emotion,
      color,
      laneOffset: (Math.random() * 1.4) - 0.7,
      zPos: 0.15 + Math.random() * 0.72,
      timestamp: Date.now()
    };

    const band = {
      id: memory.id + '-b',
      emotion,
      color,
      timestamp: Date.now()
    };

    state.memories.push(memory);
    if (state.memories.length > MAX_MEMORIES) state.memories.shift();

    state.bands.push(band);
    if (state.bands.length > MAX_BANDS) state.bands.shift();

    io.emit('memory_added', { memory, band, counts: state.counts });
  });

  socket.on('disconnect', () => {
    io.emit('online_count', io.engine.clientsCount);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Journeys on the highway running on port ${PORT}`);
});
