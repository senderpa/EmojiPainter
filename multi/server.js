/**
 * EmojiPaint Multiplayer Server
 *
 * Features:
 * - Real-time WebSocket connections
 * - Tile-based infinite canvas (1000 tiles = 32x32 grid, -16 to +15 on each axis)
 * - Stroke storage with overpaint optimization
 * - Viewport-based stroke streaming
 * - Active user tracking
 */

const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);

// Configuration
const TILE_SIZE = 512; // Canvas size (matches main app)
const TILES_PER_SIDE = 32; // 32x32 = 1024 tiles total
const TILE_MIN = -16;
const TILE_MAX = 15;
const MAX_WS_PAYLOAD_BYTES = Number(process.env.MAX_WS_PAYLOAD_BYTES || 64 * 1024);
const MAX_STROKE_POINTS = Number(process.env.MAX_STROKE_POINTS || 512);
const MAX_STROKES_PER_TILE = Number(process.env.MAX_STROKES_PER_TILE || 2000);
const MAX_MESSAGES_PER_WINDOW = Number(process.env.MAX_MESSAGES_PER_WINDOW || 120);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 10_000);
const MAX_BUFFERED_BYTES = Number(process.env.MAX_BUFFERED_BYTES || 1024 * 1024);
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';

const wss = new WebSocket.Server({
  server,
  maxPayload: MAX_WS_PAYLOAD_BYTES,
  perMessageDeflate: {
    threshold: 1024,
    concurrencyLimit: 4
  }
});

// State management
const connectedClients = new Map(); // clientId -> { ws, tileX, tileY, userId }
const tileStrokes = new Map(); // "tileX,tileY" -> array of strokes
const globalStats = {
  totalStrokes: 0,
  activeUsers: 0
};

// Generate unique client ID
function generateClientId() {
  return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get random spawn tile
function getRandomSpawnTile() {
  return {
    x: Math.floor(Math.random() * TILES_PER_SIDE) + TILE_MIN,
    y: Math.floor(Math.random() * TILES_PER_SIDE) + TILE_MIN
  };
}

// Get tile key
function getTileKey(tileX, tileY) {
  return `${tileX},${tileY}`;
}

// Get strokes for a tile
function getTileStrokes(tileX, tileY) {
  const key = getTileKey(tileX, tileY);
  if (!tileStrokes.has(key)) {
    tileStrokes.set(key, []);
  }
  return tileStrokes.get(key);
}

// Check if point is covered by newer stroke (overpaint detection)
function isPointCovered(point, strokeSize, newerStrokes) {
  for (const stroke of newerStrokes) {
    for (const p of stroke.points) {
      const distance = Math.hypot(point.x - p.x, point.y - p.y);
      const coverRadius = (stroke.size + strokeSize) / 2;
      if (distance < coverRadius) {
        return true; // Point is covered
      }
    }
  }
  return false;
}

// Optimize strokes by removing overpainted points
function optimizeStrokes(tileX, tileY) {
  const strokes = getTileStrokes(tileX, tileY);
  let removedPoints = 0;

  // Process from oldest to newest
  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    const newerStrokes = strokes.slice(i + 1);

    // Filter out covered points
    const originalLength = stroke.points.length;
    stroke.points = stroke.points.filter(point =>
      !isPointCovered(point, stroke.size, newerStrokes)
    );

    removedPoints += originalLength - stroke.points.length;
  }

  // Remove empty strokes
  const filteredStrokes = strokes.filter(s => s.points.length > 0);
  tileStrokes.set(getTileKey(tileX, tileY), filteredStrokes);

  return removedPoints;
}

// Add stroke to tile
function addStroke(tileX, tileY, stroke) {
  const strokes = getTileStrokes(tileX, tileY);
  strokes.push(stroke);
  if (strokes.length > MAX_STROKES_PER_TILE) {
    strokes.splice(0, strokes.length - MAX_STROKES_PER_TILE);
  }
  globalStats.totalStrokes++;

  // Optimize periodically (every 100 strokes per tile)
  if (strokes.length % 100 === 0) {
    const removed = optimizeStrokes(tileX, tileY);
    if (removed > 0) {
      console.log(`[Optimize] Tile ${tileX},${tileY}: Removed ${removed} covered points`);
    }
  }
}

// Get strokes in viewport (current tile + adjacent tiles)
function getViewportStrokes(centerTileX, centerTileY) {
  const viewportStrokes = [];

  // Include current tile and 8 adjacent tiles
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const tileX = centerTileX + dx;
      const tileY = centerTileY + dy;

      // Check tile bounds
      if (tileX < TILE_MIN || tileX > TILE_MAX || tileY < TILE_MIN || tileY > TILE_MAX) {
        continue;
      }

      const strokes = getTileStrokes(tileX, tileY);
      viewportStrokes.push({
        tileX,
        tileY,
        strokes: strokes.map(s => ({
          id: s.id,
          emoji: s.emoji,
          size: s.size,
          opacity: s.opacity,
          points: s.points,
          rotation: s.rotation,
          mirrorX: s.mirrorX,
          mirrorY: s.mirrorY
        }))
      });
    }
  }

  return viewportStrokes;
}

// Broadcast to all clients on same or adjacent tiles
function broadcastToViewport(tileX, tileY, message, excludeClientId = null) {
  const payload = JSON.stringify(message);
  for (const [clientId, client] of connectedClients.entries()) {
    if (clientId === excludeClientId) continue;

    // Check if client is in viewport range
    const dx = Math.abs(client.tileX - tileX);
    const dy = Math.abs(client.tileY - tileY);

    if (dx <= 1 && dy <= 1 && client.ws.readyState === WebSocket.OPEN && client.ws.bufferedAmount < MAX_BUFFERED_BYTES) {
      client.ws.send(payload);
    }
  }
}

// Broadcast stats to all clients
function broadcastStats() {
  const statsMessage = {
    type: 'stats',
    activeUsers: globalStats.activeUsers,
    totalStrokes: globalStats.totalStrokes
  };

  for (const [_, client] of connectedClients.entries()) {
    if (client.ws.readyState === WebSocket.OPEN && client.ws.bufferedAmount < MAX_BUFFERED_BYTES) {
      client.ws.send(JSON.stringify(statsMessage));
    }
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampNumber(value, min, max, fallback) {
  return isFiniteNumber(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function sanitizeStroke(input) {
  if (!input || typeof input !== 'object') return null;
  if (!Array.isArray(input.points) || input.points.length === 0 || input.points.length > MAX_STROKE_POINTS) {
    return null;
  }

  const points = [];
  for (const point of input.points) {
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;
    points.push({
      x: clampNumber(point.x, -TILE_SIZE * 2, TILE_SIZE * 2, 0),
      y: clampNumber(point.y, -TILE_SIZE * 2, TILE_SIZE * 2, 0)
    });
  }

  const emoji = typeof input.emoji === 'string' ? input.emoji.slice(0, 64) : '🎨';
  const id = typeof input.id === 'string' && input.id.length > 0
    ? input.id.slice(0, 128)
    : `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    emoji,
    size: clampNumber(input.size, 1, 256, 24),
    opacity: clampNumber(input.opacity, 0, 1, 1),
    points,
    rotation: clampNumber(input.rotation, -Math.PI * 4, Math.PI * 4, 0),
    mirrorX: input.mirrorX === true,
    mirrorY: input.mirrorY === true
  };
}

function isRateLimited(client) {
  const now = Date.now();
  client.messageTimes = client.messageTimes.filter((time) => now - time < RATE_WINDOW_MS);
  client.messageTimes.push(now);
  return client.messageTimes.length > MAX_MESSAGES_PER_WINDOW;
}

function closeForPolicy(ws, reason) {
  try {
    ws.close(1008, reason);
  } catch {
    ws.terminate();
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  const clientId = generateClientId();
  const spawnTile = getRandomSpawnTile();

  // Initialize client
  connectedClients.set(clientId, {
    ws,
    tileX: spawnTile.x,
    tileY: spawnTile.y,
    userId: clientId,
    messageTimes: []
  });

  globalStats.activeUsers = connectedClients.size;

  console.log(`[Connect] ${clientId} spawned at tile (${spawnTile.x}, ${spawnTile.y})`);
  console.log(`[Stats] Active users: ${globalStats.activeUsers}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    tileX: spawnTile.x,
    tileY: spawnTile.y,
    tileSize: TILE_SIZE,
    tileMin: TILE_MIN,
    tileMax: TILE_MAX
  }));

  // Send viewport strokes
  const viewportStrokes = getViewportStrokes(spawnTile.x, spawnTile.y);
  ws.send(JSON.stringify({
    type: 'viewport',
    strokes: viewportStrokes
  }));

  // Send stats
  broadcastStats();

  // Message handler
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      const client = connectedClients.get(clientId);

      if (!client) return;
      if (isRateLimited(client)) {
        console.warn(`[RateLimit] ${clientId} exceeded ${MAX_MESSAGES_PER_WINDOW}/${RATE_WINDOW_MS}ms`);
        closeForPolicy(ws, 'rate limit');
        return;
      }

      switch (message.type) {
        case 'stroke':
          {
          const stroke = sanitizeStroke(message.stroke);
          if (!stroke) {
            console.warn(`[Invalid] Dropping malformed stroke from ${clientId}`);
            return;
          }
          // Add stroke to current tile
          addStroke(client.tileX, client.tileY, stroke);

          // Broadcast to viewport
          broadcastToViewport(client.tileX, client.tileY, {
            type: 'stroke',
            tileX: client.tileX,
            tileY: client.tileY,
            stroke,
            userId: clientId
          }, clientId);

          // Update stats
          broadcastStats();
          }
          break;

        case 'move':
          // Update client tile position
          const newTileX = Math.max(TILE_MIN, Math.min(TILE_MAX, message.tileX));
          const newTileY = Math.max(TILE_MIN, Math.min(TILE_MAX, message.tileY));

          client.tileX = newTileX;
          client.tileY = newTileY;

          console.log(`[Move] ${clientId} moved to tile (${newTileX}, ${newTileY})`);

          // Send new viewport strokes
          const newViewportStrokes = getViewportStrokes(newTileX, newTileY);
          ws.send(JSON.stringify({
            type: 'viewport',
            strokes: newViewportStrokes
          }));
          break;

        default:
          console.warn(`[Unknown] Message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[Error] Message handling:', error);
      closeForPolicy(ws, 'invalid message');
    }
  });

  // Disconnect handler
  ws.on('close', () => {
    connectedClients.delete(clientId);
    globalStats.activeUsers = connectedClients.size;

    console.log(`[Disconnect] ${clientId}`);
    console.log(`[Stats] Active users: ${globalStats.activeUsers}`);

    broadcastStats();
  });

  // Error handler
  ws.on('error', (error) => {
    console.error(`[Error] ${clientId}:`, error);
  });
});

// CORS and cache headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json({
    status: 'ok',
    activeUsers: globalStats.activeUsers,
    totalStrokes: globalStats.totalStrokes,
    tiles: tileStrokes.size,
    uptime: process.uptime()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   EmojiPaint Multiplayer Server Running       ║
╠═══════════════════════════════════════════════╣
║   Port: ${PORT.toString().padEnd(38)}║
║   WebSocket: ws://localhost:${PORT.toString().padEnd(22)}║
║   Health: http://localhost:${PORT}/health${' '.repeat(13)}║
║   Tiles: ${TILES_PER_SIDE}x${TILES_PER_SIDE} (${(TILES_PER_SIDE * TILES_PER_SIDE).toString()} total)${' '.repeat(24 - (TILES_PER_SIDE * TILES_PER_SIDE).toString().length)}║
╚═══════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Shutdown] Closing server...');
  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });
});
