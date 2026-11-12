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

app.get('/', (req, res) => {
  const publicIndex = path.join(publicDir, 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
  if (fs.existsSync(rootIndex)) return res.sendFile(rootIndex);
  res.status(404).send('index.html not found in /public or root directory.');
});

const MAX_USERS_PER_ROOM = 100;
const MAX_BANDS = 180;
const MAX_MEMORIES = 120;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const rooms = new Map();

function createFreshRoomState() {
  return {
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
}

function getRoomState(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, createFreshRoomState());
  }
  return rooms.get(roomCode);
}

function getRoomClientCount(roomCode) {
  const room = io.sockets.adapter.rooms.get(roomCode);
  return room ? room.size : 0;
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join_room', (rawRoomCode) => {
    const roomCode = String(rawRoomCode || 'MAIN')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-_]/g, '')
      .slice(0, 20) || 'MAIN';

    if (currentRoom && currentRoom !== roomCode) {
      const prevRoom = currentRoom;
      socket.leave(prevRoom);
      io.to(prevRoom).emit('online_count', {
        count: getRoomClientCount(prevRoom),
        max: MAX_USERS_PER_ROOM
      });
    }

    const currentCount = getRoomClientCount(roomCode);
    const alreadyInRoom = currentRoom === roomCode;

    if (!alreadyInRoom && currentCount >= MAX_USERS_PER_ROOM) {
      socket.emit('room_full', {
        roomCode,
        max: MAX_USERS_PER_ROOM,
        message: 'Room "' + roomCode + '" has reached its maximum limit of ' + MAX_USERS_PER_ROOM + ' people.'
      });
      return;
    }

    currentRoom = roomCode;
    socket.join(roomCode);

    const roomState = getRoomState(roomCode);
    const updatedCount = getRoomClientCount(roomCode);

    socket.emit('init_state', {
      roomCode: roomCode,
      bands: roomState.bands,
      memories: roomState.memories,
      counts: roomState.counts,
      onlineCount: updatedCount,
      maxUsers: MAX_USERS_PER_ROOM
    });

    io.to(roomCode).emit('online_count', {
      count: updatedCount,
      max: MAX_USERS_PER_ROOM
    });
  });

  socket.on('paint_emotion', (payload) => {
    if (!currentRoom || !payload || !payload.emotion || !payload.color) return;
    const roomState = getRoomState(currentRoom);

    const emotion = String(payload.emotion).slice(0, 24);
    const color = String(payload.color).slice(0, 16);

    if (Object.prototype.hasOwnProperty.call(roomState.counts, emotion)) {
      roomState.counts[emotion] += 1;
    }

    const band = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      emotion: emotion,
      color: color,
      timestamp: Date.now()
    };

    roomState.bands.push(band);
    if (roomState.bands.length > MAX_BANDS) roomState.bands.shift();

    io.to(currentRoom).emit('emotion_painted', {
      band: band,
      counts: roomState.counts
    });
  });

  socket.on('add_memory', (payload) => {
    if (!currentRoom || !payload || typeof payload.text !== 'string') return;
    const cleanText = payload.text.trim().slice(0, 280);
    if (!cleanText) return;

    const roomState = getRoomState(currentRoom);
    const emotion = String(payload.emotion || 'Hope').slice(0, 24);
    const color = String(payload.color || '#38bdf8').slice(0, 16);

    if (Object.prototype.hasOwnProperty.call(roomState.counts, emotion)) {
      roomState.counts[emotion] += 1;
    }

    const memory = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      text: cleanText,
      emotion: emotion,
      color: color,
      laneOffset: (Math.random() * 1.4) - 0.7,
      zPos: 0.15 + Math.random() * 0.72,
      timestamp: Date.now()
    };

    const band = {
      id: memory.id + '-b',
      emotion: emotion,
      color: color,
      timestamp: Date.now()
    };

    roomState.memories.push(memory);
    if (roomState.memories.length > MAX_MEMORIES) roomState.memories.shift();

    roomState.bands.push(band);
    if (roomState.bands.length > MAX_BANDS) roomState.bands.shift();

    io.to(currentRoom).emit('memory_added', {
      memory: memory,
      band: band,
      counts: roomState.counts
    });
  });

  socket.on('reset_room', (payload) => {
    if (!currentRoom) return;
    const providedPin = payload && payload.pin ? String(payload.pin).trim() : '';

    if (providedPin !== ADMIN_PIN) {
      socket.emit('reset_error', 'Incorrect Reset PIN.');
      return;
    }

    const fresh = createFreshRoomState();
    rooms.set(currentRoom, fresh);

    io.to(currentRoom).emit('room_reset', fresh);
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      const roomCode = currentRoom;
      setTimeout(() => {
        io.to(roomCode).emit('online_count', {
          count: getRoomClientCount(roomCode),
          max: MAX_USERS_PER_ROOM
        });
      }, 50);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Journeys on the highway running on port ' + PORT);
});
// END OF SERVER.JS
