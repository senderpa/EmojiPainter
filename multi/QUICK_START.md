# Quick Start - Multiplayer Server Setup

## What You Need to Do on Your Server

Since you've already uploaded the files via FTP to `/var/www/multi/`, here's what to do next:

### 1. SSH into Your Server

```bash
ssh your-username@emojipainter.com
```

### 2. Navigate to the multi directory

```bash
cd /var/www/multi
```

### 3. Install Dependencies

```bash
npm install --production
```

### 4. Start the Server

```bash
# Install PM2 if you don't have it
npm install -g pm2

# Start server
pm2 start server.js --name emojipaint-multi

# Save configuration so it restarts on reboot
pm2 save
pm2 startup
```

### 5. Configure Nginx

The server runs on port 3000 by default. You need to configure nginx to proxy WebSocket connections.

Edit your nginx config:
```bash
sudo nano /etc/nginx/sites-available/emojipainter.com
```

Add this location block (adjust based on your setup):

```nginx
# WebSocket for multiplayer
location /ws {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
}
```

Then reload nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Update Client URL

If using `/ws` path, update the client:

In `/src/multiplayer/multiplayerClient.ts`:
```typescript
const WS_URL = __DEV__
  ? 'ws://localhost:3001'
  : 'wss://emojipainter.com/ws'; // Add /ws path
```

### 7. Test It

Check server health:
```bash
curl http://localhost:3000/health
```

Should return:
```json
{"status":"ok","activeUsers":0,"totalStrokes":0,"tiles":0,"uptime":12.345}
```

## Troubleshooting

### Server won't start
```bash
# Check if port 3000 is already in use
lsof -i :3000

# Or try a different port
PORT=3001 pm2 start server.js --name emojipaint-multi
```

### Can't connect from app
```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs emojipaint-multi

# Check nginx error log
sudo tail -f /var/nginx/error.log
```

### WebSocket connection fails
- Make sure nginx has the `Upgrade` and `Connection` headers
- Check firewall allows port 3000
- Verify SSL certificate is valid for wss://

## Quick Commands

```bash
# Start server
pm2 start emojipaint-multi

# Stop server
pm2 stop emojipaint-multi

# Restart server
pm2 restart emojipaint-multi

# View logs
pm2 logs emojipaint-multi

# Server status
pm2 status
```

## That's It!

Once nginx is configured and the server is running, the mobile app will automatically connect when users tap "Multiplayer Canvas" in the info panel.

The offline mode allows testing even if the server isn't running yet.
