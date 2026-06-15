import { WebSocketServer, WebSocket } from 'ws';
import { type IncomingMessage }       from 'http';
import pool                           from '../db/pool';

async function lookupSession(token: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM session WHERE token = $1',
      [token],
    );
    if (!rows[0]) return null;
    const row       = rows[0];
    const userId    = (row.userId    ?? row.user_id)    as string | undefined;
    const expiresAt = (row.expiresAt ?? row.expires_at) as string | Date | undefined;
    if (!userId) return null;
    if (expiresAt && new Date(expiresAt) <= new Date()) return null;
    return userId;
  } catch (err: any) {
    console.error('[WS Auth] Session lookup failed:', err.message);
    return null;
  }
}

// ── BroadcastServer ───────────────────────────────────────────────────────────
export class BroadcastServer {
  private readonly wss: WebSocketServer;
  private readonly userSockets = new Map<string, Set<WebSocket>>();

  constructor(server: import('http').Server) {
    this.wss = new WebSocketServer({ server });
    this.wss.on('connection', (ws, req) => { this.handleConnection(ws, req); });
  }

  // ── Connection handler ──────────────────────────────────────────────────────
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url    = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token  = url.searchParams.get('token') ?? '';

    if (!token) {
      ws.close(1008, 'missing session token');
      return;
    }

  
    lookupSession(token).then((userId) => {
      if (!userId) {
        ws.close(1008, 'invalid or expired session');
        return;
      }

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(ws);

      console.info(`[WS] Connected  userId=${userId.slice(0, 8)}… total=${this.connectionCount}`);

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 25_000);

      ws.on('close', () => {
        clearInterval(pingInterval);
        const sockets = this.userSockets.get(userId);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) this.userSockets.delete(userId);
        }
        console.info(`[WS] Disconnected userId=${userId.slice(0, 8)}… total=${this.connectionCount}`);
      });

      ws.on('error', (err) => {
        console.warn(`[WS] Error userId=${userId.slice(0, 8)}…`, err.message);
      });

    }).catch((err) => {
      console.error('[WS] Unexpected auth error:', err.message);
      ws.close(1011, 'internal error');
    });
  }

  // ── Send to one user (all their tabs) ──────────────────────────────────────
  sendToUser(userId: string, payload: object): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets?.size) return;
    const msg = JSON.stringify(payload);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg, (err) => { if (err) console.warn('[WS] Send error:', err.message); });
      }
    }
  }

  // ── Broadcast to ALL connected users (e.g. LIVE_EVENT feed) ─────────────────
  broadcast(payload: object): void {
    const msg = JSON.stringify(payload);
    for (const sockets of this.userSockets.values()) {
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(msg, (err) => { if (err) console.warn('[WS] Broadcast error:', err.message); });
        }
      }
    }
  }

  // ── Total open connections ───────────────────────────────────────────────────
  get connectionCount(): number {
    let n = 0;
    for (const sockets of this.userSockets.values()) n += sockets.size;
    return n;
  }
}