#!/usr/bin/env node
/**
 * Quick WebSocket connection test
 * Usage: node test-connection.js
 */

const WebSocket = require('ws');

const WS_URL = 'wss://some-sender.gotdns.ch:4849';

console.log('Testing WebSocket connection to:', WS_URL);
console.log('---');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ WebSocket connection established!');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('📨 Received message:', JSON.stringify(message, null, 2));

  if (message.type === 'welcome') {
    console.log('✅ Welcome message received!');
    console.log('   Client ID:', message.clientId);
    console.log('   Spawn Tile:', `(${message.tileX}, ${message.tileY})`);
    console.log('   Tile Size:', message.tileSize);
    console.log('---');
    console.log('🎉 SERVER IS FULLY OPERATIONAL!');

    // Close after successful test
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 1000);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('Connection closed');
});

// Timeout after 10 seconds
setTimeout(() => {
  console.error('❌ Connection timeout');
  ws.close();
  process.exit(1);
}, 10000);
