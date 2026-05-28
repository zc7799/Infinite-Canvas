export interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  props: Record<string, unknown>;
  zIndex?: number;
}

export interface CanvasConnection {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasData {
  id: string;
  title: string;
  icon: string;
  kind: 'classic' | 'smart';
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  viewport: CanvasViewport;
  logs: Record<string, unknown>[];
  settings: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
}
