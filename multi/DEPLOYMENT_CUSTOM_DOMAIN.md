# Deployment to Custom Domain with Port 4849

This guide explains how to deploy the multiplayer server to `https://some-sender.gotdns.ch:4849/`

## Prerequisites

- Linux server with SSH access
- Node.js and npm installed
- SSL certificate for `some-sender.gotdns.ch`
- Port 4849 open in firewall

## Step 1: Upload Files

Upload the entire `/multi` directory to your server. Example using `scp`:

```bash
# From your local machine
cd /Users/senderp/emojipaint-mobile2029
scp -r multi/ user@some-sender.gotdns.ch:/var/www/multi/
```

Or use FTP/SFTP client to upload to `/var/www/multi/`

## Step 2: SSH into Server

```bash
ssh user@some-sender.gotdns.ch
cd /var/www/multi
```

## Step 3: Install Dependencies

```bash
npm install --production
```

## Step 4: Start Server on Port 4849

```bash
# Install PM2 globally (if not already installed)
npm install -g pm2

# Start server on port 4849
PORT=4849 pm2 start server.js --name emojipaint-multi

# Save PM2 configuration
pm2 save

# Set PM2 to start on server boot
pm2 startup
```

## Step 5: Configure Firewall

Make sure port 4849 is open:

```bash
# For ufw (Ubuntu/Debian)
sudo ufw allow 4849/tcp

# For firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=4849/tcp
sudo firewall-cmd --reload

# For iptables
sudo iptables -A INPUT -p tcp --dport 4849 -j ACCEPT
sudo service iptables save
```

## Step 6: SSL/TLS Configuration

### Option A: Direct HTTPS Server (Recommended)

If you want the Node.js server to handle HTTPS directly, modify `server.js`:

```javascript
const https = require('https');
const fs = require('fs');

// Load SSL certificate
const httpsOptions = {
  key: fs.readFileSync('/path/to/privkey.pem'),
  cert: fs.readFileSync('/path/to/fullchain.pem')
};

// Create HTTPS server instead of HTTP
const server = https.createServer(httpsOptions, app);

// WebSocket will automatically use secure connection
const wss = new WebSocket.Server({ server });
```

### Option B: Nginx Reverse Proxy

If using nginx as reverse proxy:

```nginx
# /etc/nginx/sites-available/emojipaint-multi

server {
    listen 4849 ssl http2;
    server_name some-sender.gotdns.ch;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/some-sender.gotdns.ch/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/some-sender.gotdns.ch/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # WebSocket and HTTP proxy
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # WebSocket headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeout settings
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/emojipaint-multi /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

If using nginx proxy, start the server on internal port:

```bash
PORT=3000 pm2 start server.js --name emojipaint-multi
```

## Step 7: Verify Deployment

### Check Server Status

```bash
pm2 status
```

Should show:
```
┌─────┬────────────────────┬─────────┐
│ id  │ name               │ status  │
├─────┼────────────────────┼─────────┤
│ 0   │ emojipaint-multi   │ online  │
└─────┴────────────────────┴─────────┘
```

### Check Health Endpoint

```bash
# If using direct HTTPS (Option A)
curl https://some-sender.gotdns.ch:4849/health

# If using nginx proxy (Option B)
curl https://some-sender.gotdns.ch:4849/health
```

Expected response:
```json
{
  "status": "ok",
  "activeUsers": 0,
  "totalStrokes": 0,
  "tiles": 0,
  "uptime": 12.345
}
```

### View Server Logs

```bash
pm2 logs emojipaint-multi
```

## Step 8: Test from Mobile App

The app is already configured to connect to:
- **Development**: `ws://localhost:3001`
- **Production**: `wss://some-sender.gotdns.ch:4849`

Build and run the production app to test the connection.

## Troubleshooting

### Connection Refused

```bash
# Check if server is listening on correct port
netstat -tlnp | grep 4849

# Or with ss
ss -tlnp | grep 4849
```

### SSL Certificate Issues

```bash
# Test SSL certificate
openssl s_client -connect some-sender.gotdns.ch:4849

# For Let's Encrypt, renew if expired
sudo certbot renew
```

### WebSocket Connection Fails

Check nginx error logs if using proxy:
```bash
sudo tail -f /var/log/nginx/error.log
```

Check PM2 logs:
```bash
pm2 logs emojipaint-multi --lines 100
```

### Firewall Blocking

```bash
# Test from outside
telnet some-sender.gotdns.ch 4849

# Or use netcat
nc -zv some-sender.gotdns.ch 4849
```

## Environment Variables

You can customize the server with environment variables:

```bash
# Change port
PORT=4849 pm2 start server.js --name emojipaint-multi

# Or use PM2 ecosystem file
# Create ecosystem.config.js:
module.exports = {
  apps: [{
    name: 'emojipaint-multi',
    script: './server.js',
    env: {
      PORT: 4849
    }
  }]
}

# Then start with:
pm2 start ecosystem.config.js
```

## Monitoring

```bash
# Server status
pm2 status

# View logs in real-time
pm2 logs emojipaint-multi

# Monitor resources
pm2 monit

# Restart server
pm2 restart emojipaint-multi

# Stop server
pm2 stop emojipaint-multi
```

## Automatic Updates

To deploy updates:

```bash
# Upload new files via scp or FTP
scp -r multi/ user@some-sender.gotdns.ch:/var/www/multi/

# SSH and restart
ssh user@some-sender.gotdns.ch
cd /var/www/multi
pm2 restart emojipaint-multi
```

## Security Recommendations

1. **Use HTTPS/WSS**: Always use secure connections in production
2. **Rate Limiting**: Consider adding rate limiting for stroke messages
3. **Authentication**: Add user authentication if needed
4. **Firewall**: Only open port 4849, keep other ports closed
5. **Updates**: Keep Node.js and dependencies updated

## Client Configuration

The mobile app is already configured with:

**File**: `/src/multiplayer/multiplayerClient.ts`

```typescript
const WS_URL = __DEV__
  ? 'ws://localhost:3001'
  : 'wss://some-sender.gotdns.ch:4849';

const HEALTH_URL = __DEV__
  ? 'http://localhost:3001/health'
  : 'https://some-sender.gotdns.ch:4849/health';
```

## Features

- ✅ Automatic server health check before connecting
- ✅ Offline mode fallback for testing
- ✅ Real-time stroke synchronization
- ✅ Tile-based infinite canvas (1024 tiles)
- ✅ Viewport-based rendering (only loads 9 tiles at a time)
- ✅ Overpaint optimization (reduces data size)
- ✅ Active user count and total strokes counter
- ✅ Worldwide access via custom domain

## Production Checklist

- [ ] Files uploaded to server
- [ ] Dependencies installed (`npm install --production`)
- [ ] PM2 installed and configured
- [ ] Server running on port 4849 (or nginx proxy configured)
- [ ] Firewall allows port 4849
- [ ] SSL certificate installed and valid
- [ ] Health endpoint returns 200 OK
- [ ] PM2 configured to start on boot (`pm2 startup`)
- [ ] Server logs show no errors (`pm2 logs`)
- [ ] Mobile app connects successfully in production mode

---

**Ready for worldwide multiplayer!** 🌍🎨
