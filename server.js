const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Shared multiplayer state (starts clean with zero pre-filled messages)
const state = {
  bands: [],     // { id, color, emotion, timestamp }
  memories: [],  // { id, text, color, emotion, laneOffset, zPos, timestamp }
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
  // Send full current highway state to newly joined user
  socket.emit('init_state', {
    ...state,
    onlineCount: io.engine.clientsCount
  });

  // Notify everyone of live participant count
  io.emit('online_count', io.engine.clientsCount);

  // Handle emotion paint event
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
    if (state.bands.length > MAX_BANDS) {
      state.bands.shift();
    }

    io.emit('emotion_painted', {
      band,
      counts: state.counts
    });
  });

  // Handle anonymous memory submission
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
      laneOffset: (Math.random() * 1.4) - 0.7, // spread across lanes
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
    if (state.memories.length > MAX_MEMORIES) {
      state.memories.shift();
    }

    state.bands.push(band);
    if (state.bands.length > MAX_BANDS) {
      state.bands.shift();
    }

    io.emit('memory_added', {
      memory,
      band,
      counts: state.counts
    });
  });

  socket.on('disconnect', () => {
    io.emit('online_count', io.engine.clientsCount);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Journeys on the highway running on port ${PORT}`);
});