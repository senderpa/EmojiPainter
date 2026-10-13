/**
 * Multiplayer WebSocket Client
 *
 * Handles real-time communication with the multiplayer server
 */

import type { Stroke } from '../state/PaintingContext';

// WebSocket URL - uses secure wss:// for production.
// The MultiPaint server moved to port 4850 (4849 is now a different app), and
// the WS endpoint lives at the "/ws" path (matches the web client:
// `protocol + '//' + location.host + '/ws'`).
const WS_URL = 'wss://some-sender.gotdns.ch:4850/ws';

// Health check URL — 4850 has no /health; /api/status returns {"status":"ok",…}.
const HEALTH_URL = 'https://some-sender.gotdns.ch:4850/api/status';

/**
 * Check if multiplayer server is available
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    console.log('[Multiplayer] Checking server health:', HEALTH_URL);

    // Create manual timeout promise
    const timeoutPromise = new Promise<Response>((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 8000);
    });

    const fetchPromise = fetch(HEALTH_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    console.log('[Multiplayer] Health check response status:', response.status);

    if (!response.ok) {
      console.log('[Multiplayer] Server returned error:', response.status);
      return false;
    }

    const data = await response.json();
    const isHealthy = data.status === 'ok';
    console.log('[Multiplayer] Server health check:', isHealthy ? 'ONLINE' : 'OFFLINE', data);
    return isHealthy;
  } catch (error) {
    console.error('[Multiplayer] Server health check failed:', error);
    if (error instanceof Error) {
      console.error('[Multiplayer] Error details:', error.message);
    }
    return false;
  }
}

export interface TilePosition {
  x: number;
  y: number;
}

export interface TileStrokes {
  tileX: number;
  tileY: number;
  strokes: Stroke[];
}

export interface MultiplayerStats {
  activeUsers: number;
  totalStrokes: number;
}

export type MessageHandler = (message: any) => void;

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  public clientId: string | null = null;
  public currentTile: TilePosition = { x: 0, y: 0 };
  public tileSize = 512;
  public tileMin = -16;
  public tileMax = 15;

  constructor() {}

  /**
   * Connect to multiplayer server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('[Multiplayer] Connecting to', WS_URL);

        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
          console.log('[Multiplayer] Connected');
          this.reconnectAttempts = 0;
          // resolve will be called when welcome message is received
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Handle welcome message
            if (message.type === 'welcome') {
              this.clientId = message.clientId;
              this.currentTile = { x: message.tileX, y: message.tileY };
              this.tileSize = message.tileSize;
              this.tileMin = message.tileMin;
              this.tileMax = message.tileMax;

              console.log('[Multiplayer] Welcome received', {
                clientId: this.clientId,
                tile: this.currentTile
              });

              resolve();
            }

            // Notify all handlers
            this.messageHandlers.forEach(handler => handler(message));
          } catch (error) {
            console.error('[Multiplayer] Message parse error:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[Multiplayer] WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[Multiplayer] Disconnected');
          this.handleDisconnect();
        };
      } catch (error) {
        console.error('[Multiplayer] Connection error:', error);
        reject(error);
      }
    });
  }

  /**
   * Handle disconnection and attempt reconnect
   */
  private handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

      console.log(`[Multiplayer] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      this.reconnectTimer = setTimeout(() => {
        this.connect().catch(error => {
          console.error('[Multiplayer] Reconnect failed:', error);
        });
      }, delay);
    } else {
      console.error('[Multiplayer] Max reconnect attempts reached');
    }
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.messageHandlers.clear();
    this.clientId = null;
  }

  /**
   * Subscribe to messages
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);

    // Return unsubscribe function
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Send stroke to server
   */
  sendStroke(stroke: Stroke) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Multiplayer] Cannot send stroke - not connected');
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'stroke',
      stroke: {
        id: stroke.id,
        emoji: stroke.emoji,
        size: stroke.size,
        opacity: stroke.opacity,
        points: stroke.points,
        rotation: stroke.rotation,
        mirrorX: stroke.mirrorX,
        mirrorY: stroke.mirrorY
      }
    }));
  }

  /**
   * Send activity heartbeat to server
   */
  sendActivity() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'activity',
      timestamp: Date.now()
    }));
  }

  /**
   * Move to a different tile
   */
  moveTo(tileX: number, tileY: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Multiplayer] Cannot move - not connected');
      return;
    }

    // Clamp to tile bounds
    const clampedX = Math.max(this.tileMin, Math.min(this.tileMax, tileX));
    const clampedY = Math.max(this.tileMin, Math.min(this.tileMax, tileY));

    this.currentTile = { x: clampedX, y: clampedY };

    this.ws.send(JSON.stringify({
      type: 'move',
      tileX: clampedX,
      tileY: clampedY
    }));

    console.log('[Multiplayer] Moved to tile', this.currentTile);
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
