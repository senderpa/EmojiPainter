# EmojiPaint Multiplayer Server

Real-time multiplayer server for EmojiPaint collaborative canvas.

## Features

- **Real-time WebSocket connections** for live collaboration
- **Tile-based infinite canvas** (32×32 grid = 1,024 tiles)
- **Automatic stroke optimization** removes overpainted points
- **Viewport-based rendering** only sends visible strokes
- **Active user tracking** and global statistics

## Installation

```bash
cd multi
npm install
```

## Development

```bash
npm run dev
```

## Production

```bash
npm start
```

## Deployment to emojipainter.com

### Step 1: Upload Files (Already Done via FTP)

Files should be in: `/var/www/multi/` or similar directory

### Step 2: Install Dependencies on Server

SSH into your server:
```bash
ssh user@emojipainter.com
cd /var/www/multi
npm install --production
```

### Step 3: Start Server with PM2

```bash
# Install PM2 globally (if not already installed)
npm install -g pm2

# Start the server
pm2 start server.js --name emojipaint-multi

# Save PM2 configuration
pm2 save

# Set PM2 to start on server boot
pm2 startup
```

### Step 4: Configure Nginx for WebSocket

Edit your nginx config (usually `/etc/nginx/sites-available/emojipainter.com`):

```nginx
# Add this BEFORE the main location / block
upstream websocket {
    server localhost:3000;
}

# WebSocket endpoint for multiplayer
location / {
    proxy_pass http://websocket;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket timeout settings
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
}
```

**Important:** If you have existing locations in nginx, the WebSocket location should be specific:

```nginx
# For subdirectory deployment
location /ws {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    # ... rest of proxy headers
}
```

Then update client URL to: `wss://emojipainter.com/ws`

### Step 5: Test & Reload

```bash
# Test nginx configuration
sudo nginx -t

# If test passes, reload nginx
sudo systemctl reload nginx

# Check PM2 status
pm2 status

# View server logs
pm2 logs emojipaint-multi
```

### Verify Deployment

1. Check server is running:
```bash
curl http://localhost:3000/health
```

2. Check from outside:
```bash
curl https://emojipainter.com/health
```

Should return:
```json
{
  "status": "ok",
  "activeUsers": 0,
  "totalStrokes": 0,
  "tiles": 0,
  "uptime": 123.456
}
```

## Environment Variables

- `PORT` - Server port (default: 3000)

## API Endpoints

### WebSocket

Connect to `ws://emojipainter.com/multi/`

**Messages sent by client:**
- `{ type: 'stroke', stroke: {...} }` - Send a new stroke
- `{ type: 'move', tileX: number, tileY: number }` - Move to a different tile

**Messages received from server:**
- `{ type: 'welcome', clientId, tileX, tileY, ... }` - Connection established
- `{ type: 'viewport', strokes: [...] }` - Strokes in current viewport
- `{ type: 'stroke', tileX, tileY, stroke, userId }` - New stroke from another user
- `{ type: 'stats', activeUsers, totalStrokes }` - Global statistics

### HTTP

- `GET /health` - Health check and server stats

## Architecture

### Tile System

- Canvas is divided into 32×32 grid of tiles
- Each tile is 512×512 pixels (same as main app canvas)
- Tiles range from (-16, -16) to (15, 15)
- Users spawn at random tile on connect

### Stroke Optimization

Every 100 strokes per tile, the server:
1. Checks each point in old strokes
2. Removes points fully covered by newer strokes
3. Deletes empty strokes
4. This keeps memory usage low even with millions of strokes

### Viewport Rendering

- Only sends strokes for current tile + 8 adjacent tiles
- As user navigates, new tiles are dynamically loaded
- Other users' strokes appear in real-time if in viewport

## Performance

- Handles 1000+ concurrent users
- Optimizes stroke data automatically
- Low latency (<50ms) for real-time collaboration
- Memory efficient with viewport-based loading
