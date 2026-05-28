type MessageHandler = (data: unknown) => void;
type ConnectionHandler = () => void;

class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private handlers = new Map<string, Set<MessageHandler>>();
  private onConnectHandlers = new Set<ConnectionHandler>();
  private onDisconnectHandlers = new Set<ConnectionHandler>();
  private clientId: string;

  constructor(clientId: string = '') {
    this.clientId = clientId;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : '';
    this.url = `${protocol}//${location.host}/ws/stats${query}`;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      for (const handler of this.onConnectHandlers) handler();
    };
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const type = msg.type;
        if (type && this.handlers.has(type)) {
          for (const handler of this.handlers.get(type)!) {
            handler(msg);
          }
        }
      } catch {
        // ignore unparseable
      }
    };
    this.ws.onclose = () => {
      for (const handler of this.onDisconnectHandlers) handler();
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect(): void {
    this.reconnectDelay = this.maxReconnectDelay;
    this.ws?.close();
    this.ws = null;
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.onConnectHandlers.add(handler);
    return () => this.onConnectHandlers.delete(handler);
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.onDisconnectHandlers.add(handler);
    return () => this.onDisconnectHandlers.delete(handler);
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }
}

export const wsClient = new WsClient();
export { WsClient };
