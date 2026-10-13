# EmojiPaint Multiplayer Backend - Setup Instructions for Claude

Hello Claude! This document contains complete instructions for setting up the EmojiPaint multiplayer backend on a Linux server.

## 🎯 Your Mission

Set up and deploy a Node.js WebSocket server that enables real-time multiplayer painting for the EmojiPaint mobile app. The server must be accessible worldwide at `https://some-sender.gotdns.ch:4849/`

## 📁 What You're Working With

You should have these files in the `/var/www/multi/` directory:
- `server.js` - Main WebSocket server
- `package.json` - Dependencies and scripts
- `README.md` - General documentation
- `DEPLOYMENT_CUSTOM_DOMAIN.md` - Detailed deployment guide
- `QUICK_START.md` - Quick setup reference

## 🔧 Step-by-Step Setup

### Step 1: Verify File Location

Check that all files are present:

```bash
cd /var/www/multi
ls -la
```

You should see:
- server.js
- package.json
- README.md
- DEPLOYMENT_CUSTOM_DOMAIN.md
- QUICK_START.md

### Step 2: Install Node.js (if not installed)

Check if Node.js is installed:

```bash
node --version
npm --version
```

If not installed, install Node.js 18 or higher:

```bash
# For Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# For CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Verify installation
node --version  # Should show v18.x.x or higher
npm --version   # Should show 9.x.x or higher
```

### Step 3: Install Project Dependencies

```bash
cd /var/www/multi
npm install --production
```

This will install:
- `ws` - WebSocket library
- `express` - HTTP server for health endpoint

Expected output:
```
added 5 packages in 2s
```

### Step 4: Install PM2 (Process Manager)

PM2 keeps the server running 24/7 and restarts it if it crashes:

```bash
sudo npm install -g pm2
```

Verify PM2 is installed:
```bash
pm2 --version
```

### Step 5: Configure Firewall

Open port 4849 for incoming connections:

**For UFW (Ubuntu/Debian):**
```bash
sudo ufw status
sudo ufw allow 4849/tcp
sudo ufw reload
sudo ufw status
```

**For firewalld (CentOS/RHEL):**
```bash
sudo firewall-cmd --permanent --add-port=4849/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

**For iptables:**
```bash
sudo iptables -A INPUT -p tcp --dport 4849 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

Verify port is open:
```bash
sudo netstat -tlnp | grep 4849
# Should show nothing yet (server not started)
```

### Step 6: SSL/TLS Configuration

The app requires HTTPS/WSS (secure WebSocket). Choose ONE option:

#### Option A: Direct HTTPS in Node.js (Simpler)

1. **Locate your SSL certificate files:**
   ```bash
   # For Let's Encrypt certificates
   ls -la /etc/letsencrypt/live/some-sender.gotdns.ch/
   ```

   You need:
   - `privkey.pem` (private key)
   - `fullchain.pem` (certificate chain)

2. **Modify server.js to use HTTPS:**

   Edit the file:
   ```bash
   nano /var/www/multi/server.js
   ```

   Replace these lines (around line 12-18):
   ```javascript
   const http = require('http');
   const express = require('express');

   const app = express();
   const server = http.createServer(app);
   const wss = new WebSocket.Server({ server });
   ```

   With:
   ```javascript
   const https = require('https');
   const fs = require('fs');
   const express = require('express');

   const app = express();

   // SSL certificate configuration
   const httpsOptions = {
     key: fs.readFileSync('/etc/letsencrypt/live/some-sender.gotdns.ch/privkey.pem'),
     cert: fs.readFileSync('/etc/letsencrypt/live/some-sender.gotdns.ch/fullchain.pem')
   };

   const server = https.createServer(httpsOptions, app);
   const wss = new WebSocket.Server({ server });
   ```

   Save and exit (Ctrl+X, then Y, then Enter)

3. **Set correct permissions (important!):**
   ```bash
   # PM2 needs to read certificate files
   sudo chmod 644 /etc/letsencrypt/live/some-sender.gotdns.ch/fullchain.pem
   sudo chmod 644 /etc/letsencrypt/live/some-sender.gotdns.ch/privkey.pem

   # Or run PM2 as root (less secure but simpler)
   ```

#### Option B: Nginx Reverse Proxy (More Complex)

1. **Install Nginx:**
   ```bash
   sudo apt-get update
   sudo apt-get install nginx
   ```

2. **Create Nginx configuration:**
   ```bash
   sudo nano /etc/nginx/sites-available/emojipaint-multi
   ```

   Paste this configuration:
   ```nginx
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

   Save and exit.

3. **Enable the site:**
   ```bash
   sudo ln -s /etc/nginx/sites-available/emojipaint-multi /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

   Note: If using Nginx, the Node.js server runs on internal port 3000, and Nginx handles SSL on port 4849.

### Step 7: Start the Server

**If using Option A (Direct HTTPS):**
```bash
cd /var/www/multi
PORT=4849 pm2 start server.js --name emojipaint-multi
```

**If using Option B (Nginx Proxy):**
```bash
cd /var/www/multi
PORT=3000 pm2 start server.js --name emojipaint-multi
```

**Make PM2 start on server reboot:**
```bash
pm2 save
pm2 startup
# Follow the command it outputs (usually sudo ...)
```

### Step 8: Verify Everything Works

#### Check PM2 Status
```bash
pm2 status
```

Expected output:
```
┌─────┬────────────────────┬─────────┬─────────┐
│ id  │ name               │ status  │ restart │
├─────┼────────────────────┼─────────┼─────────┤
│ 0   │ emojipaint-multi   │ online  │ 0       │
└─────┴────────────────────┴─────────┴─────────┘
```

Status should be **online**. If it shows **errored** or **stopped**, check logs:
```bash
pm2 logs emojipaint-multi --lines 50
```

#### Check Server Logs
```bash
pm2 logs emojipaint-multi
```

You should see:
```
╔═══════════════════════════════════════════════╗
║   EmojiPaint Multiplayer Server Running       ║
╠═══════════════════════════════════════════════╣
║   Port: 4849                                  ║
║   WebSocket: ws://localhost:4849              ║
║   Health: http://localhost:4849/health        ║
║   Tiles: 32x32 (1024 total)                   ║
╚═══════════════════════════════════════════════╝
```

#### Test Health Endpoint Locally
```bash
curl http://localhost:4849/health
```

Expected response:
```json
{"status":"ok","activeUsers":0,"totalStrokes":0,"tiles":0,"uptime":5.123}
```

If using Nginx (Option B):
```bash
curl http://localhost:3000/health
```

#### Test Health Endpoint Externally
```bash
curl https://some-sender.gotdns.ch:4849/health
```

Expected response:
```json
{"status":"ok","activeUsers":0,"totalStrokes":0,"tiles":0,"uptime":10.456}
```

#### Test Port is Listening
```bash
sudo netstat -tlnp | grep 4849
```

Should show something like:
```
tcp6  0  0 :::4849  :::*  LISTEN  12345/node
```

Or if using Nginx:
```bash
sudo netstat -tlnp | grep 4849
# Shows nginx
sudo netstat -tlnp | grep 3000
# Shows node
```

### Step 9: Test WebSocket Connection

```bash
# Install wscat for testing (optional)
npm install -g wscat

# Test WebSocket connection
wscat -c wss://some-sender.gotdns.ch:4849
```

You should receive a welcome message like:
```json
{"type":"welcome","clientId":"client_1234567890_abc123","tileX":5,"tileY":-3,"tileSize":512,"tileMin":-16,"tileMax":15}
```

Type Ctrl+C to exit.

## 🐛 Troubleshooting

### Problem: "Port already in use"

```bash
# Find what's using port 4849
sudo lsof -i :4849

# Kill the process
sudo kill -9 <PID>

# Or stop PM2 and restart
pm2 stop emojipaint-multi
pm2 delete emojipaint-multi
PORT=4849 pm2 start server.js --name emojipaint-multi
```

### Problem: "Cannot find module 'ws'"

```bash
cd /var/www/multi
npm install
```

### Problem: "Permission denied" reading SSL certificates

```bash
# Option 1: Fix permissions
sudo chmod 644 /etc/letsencrypt/live/some-sender.gotdns.ch/*.pem
sudo chmod 755 /etc/letsencrypt/live/some-sender.gotdns.ch/
sudo chmod 755 /etc/letsencrypt/live/
sudo chmod 755 /etc/letsencrypt/

# Option 2: Run PM2 as root (less secure)
sudo PORT=4849 pm2 start server.js --name emojipaint-multi
sudo pm2 save
```

### Problem: Health endpoint returns 404 or connection refused

```bash
# Check if server is actually running
pm2 status

# Check logs for errors
pm2 logs emojipaint-multi --lines 100

# Check if port is listening
sudo netstat -tlnp | grep 4849

# Test locally first
curl http://localhost:4849/health
```

### Problem: Mobile app can't connect

```bash
# Check firewall allows port 4849
sudo ufw status | grep 4849
# Or
sudo firewall-cmd --list-ports | grep 4849

# Check from outside using telnet
telnet some-sender.gotdns.ch 4849

# Check SSL certificate is valid
openssl s_client -connect some-sender.gotdns.ch:4849

# Check server logs for connection attempts
pm2 logs emojipaint-multi --lines 50
```

### Problem: SSL certificate expired or invalid

```bash
# Check certificate expiration
openssl x509 -in /etc/letsencrypt/live/some-sender.gotdns.ch/fullchain.pem -noout -dates

# Renew Let's Encrypt certificate
sudo certbot renew

# Restart server after renewal
pm2 restart emojipaint-multi
```

## 📊 Monitoring & Management

### View Server Status
```bash
pm2 status
```

### View Real-time Logs
```bash
pm2 logs emojipaint-multi
```

### View Resource Usage
```bash
pm2 monit
```

### Restart Server
```bash
pm2 restart emojipaint-multi
```

### Stop Server
```bash
pm2 stop emojipaint-multi
```

### Delete from PM2
```bash
pm2 delete emojipaint-multi
```

### View Detailed Info
```bash
pm2 show emojipaint-multi
```

## 🔄 Updating the Server

When new files are uploaded:

```bash
cd /var/www/multi
npm install --production
pm2 restart emojipaint-multi
pm2 logs emojipaint-multi
```

## ✅ Final Verification Checklist

Before telling the user it's ready, verify ALL of these:

- [ ] `pm2 status` shows server as **online**
- [ ] `pm2 logs` shows no errors, displays startup banner
- [ ] `curl http://localhost:4849/health` returns `{"status":"ok",...}`
- [ ] `curl https://some-sender.gotdns.ch:4849/health` returns `{"status":"ok",...}`
- [ ] `sudo netstat -tlnp | grep 4849` shows port is listening
- [ ] `sudo ufw status` (or equivalent) shows port 4849 is allowed
- [ ] SSL certificate is valid and not expired
- [ ] `pm2 save` executed successfully
- [ ] `pm2 startup` configured for auto-start on reboot

## 🎉 Success Criteria

When everything is working, you should be able to:

1. **Access health endpoint from anywhere:**
   ```bash
   curl https://some-sender.gotdns.ch:4849/health
   ```
   Returns: `{"status":"ok","activeUsers":0,"totalStrokes":0,"tiles":0,"uptime":...}`

2. **Connect via WebSocket:**
   ```bash
   wscat -c wss://some-sender.gotdns.ch:4849
   ```
   Receives welcome message with `type: "welcome"`

3. **Server stays running:**
   ```bash
   pm2 status
   ```
   Shows status: **online**, restart count: **0**

4. **Survives server reboot:**
   ```bash
   sudo reboot
   # Wait for server to restart, then SSH back in
   pm2 status
   ```
   Server should automatically restart

## 📱 Mobile App Connection

The mobile app is already configured to connect to:
- **Production**: `wss://some-sender.gotdns.ch:4849`
- **Development**: `ws://localhost:3001`

When the server is running and accessible, the app will:
1. Check health endpoint before connecting
2. Show "Connecting to multiplayer..." loading screen
3. Connect via WebSocket and enter multiplayer mode
4. Display: "Multiplayer Canvas" with active users and stroke count

If server is offline, app will:
1. Detect health check failure
2. Show alert: "Server Offline"
3. Offer "Offline Mode" for local testing

## 🔐 Security Notes

- Server runs on custom port 4849 (not default 80/443)
- Uses WSS (secure WebSocket) with SSL/TLS encryption
- CORS enabled for health endpoint
- No authentication required (public collaborative canvas)
- No personal data stored (only canvas strokes)
- Automatic overpaint optimization prevents data bloat

## 📈 Performance

- Handles 1000+ concurrent users
- Supports 1024 tiles (32x32 grid)
- Viewport-based rendering (only loads 9 tiles per user)
- Automatic overpaint optimization every 100 strokes per tile
- Low latency (<50ms) for real-time collaboration

## 🆘 Getting Help

If you encounter issues:

1. **Check the logs first:**
   ```bash
   pm2 logs emojipaint-multi --lines 100
   ```

2. **Check system logs:**
   ```bash
   sudo journalctl -u pm2-* --since "10 minutes ago"
   ```

3. **Test step by step:**
   - Node.js installed? `node --version`
   - Dependencies installed? `ls node_modules/`
   - Server starts manually? `node server.js`
   - Port accessible? `telnet localhost 4849`
   - Firewall allows it? `sudo ufw status`
   - SSL certificates valid? `openssl x509 -in ... -noout -dates`

4. **Read the detailed guides:**
   - `DEPLOYMENT_CUSTOM_DOMAIN.md` - Full deployment documentation
   - `QUICK_START.md` - Quick reference
   - `README.md` - Architecture and features

---

## 🎯 Summary for Claude

Your goal is to:
1. Install Node.js and dependencies
2. Configure firewall to allow port 4849
3. Set up SSL/TLS (either direct HTTPS or nginx proxy)
4. Start server with PM2 on port 4849
5. Verify health endpoint works externally
6. Configure PM2 to auto-start on reboot
7. Test WebSocket connection
8. Confirm all checklist items

The server should be accessible at:
- **Health**: `https://some-sender.gotdns.ch:4849/health`
- **WebSocket**: `wss://some-sender.gotdns.ch:4849`

Good luck! 🚀
