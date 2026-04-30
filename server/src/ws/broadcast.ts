import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server as HTTPServer } from 'http';
import { parse } from 'url';


export class BroadcastServer {
  private readonly wss: WebSocketServer;
  private readonly rooms = new Map<string, Set<WebSocket>>();

  constructor(httpServer: HTTPServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.setup();
  }

  // ─── Setup ───────────────────────────────────────────────────────────────

  private setup(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const userId = this.parseUserId(req);
      if (!userId) { ws.close(1008, 'missing userId'); return; }

      // Join room
      if (!this.rooms.has(userId)) this.rooms.set(userId, new Set());
      this.rooms.get(userId)!.add(ws);

      this.send(ws, { type: 'connected', userId });

      // Keepalive
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
        else { clearInterval(ping); }
      }, 25_000);

      ws.on('pong', () => { /* alive */ });

      ws.on('close', () => {
        clearInterval(ping);
        const room = this.rooms.get(userId);
        if (room) {
          room.delete(ws);
          if (!room.size) this.rooms.delete(userId);
        }
      });

      ws.on('error', () => ws.terminate());
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────────

 
  sendToUser(userId: string, payload: unknown): void {
    const sockets = this.rooms.get(userId);
    if (!sockets?.size) return;
    const msg = JSON.stringify(payload);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }


  broadcast(payload: unknown): void {
    const msg = JSON.stringify(payload);
    for (const sockets of this.rooms.values()) {
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      }
    }
  }

  get connectionCount(): number {
    let n = 0;
    for (const s of this.rooms.values()) n += s.size;
    return n;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private parseUserId(req: IncomingMessage): string | null {
    const { query } = parse(req.url ?? '', true);
    const uid = query.userId;
    return typeof uid === 'string' && uid.length > 0 ? uid : null;
  }

  private send(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }
}