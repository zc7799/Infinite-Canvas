export interface AIReference {
  url: string;
  name: string;
  role: string;
}

export interface OnlineImageRequest {
  prompt: string;
  provider_id: string;
  model: string;
  size: string;
  quality: string;
  n: number;
  reference_images: AIReference[];
}

export interface ChatRequest {
  conversation_id: string;
  message: string;
  model: string;
  image_model: string;
  mode: 'chat' | 'image';
  size: string;
  quality: string;
  reference_images: AIReference[];
  provider: string;
  ms_model: string;
}

export interface CanvasVideoRequest {
  prompt: string;
  provider_id: string;
  model: string;
  duration: number;
  aspect_ratio: string;
  resolution: string;
  size: string;
  images: AIReference[];
  videos: string[];
  enhance_prompt: boolean;
  enable_upsample: boolean;
  watermark: boolean;
  seed?: number;
  camerafixed: boolean;
  return_last_frame: boolean;
  generate_audio: boolean;
}

export interface CanvasLLMRequest {
  message: string;
  system_prompt: string;
  model: string;
  messages: Record<string, unknown>[];
  provider: string;
  ms_model: string;
  images: string[];
  videos: string[];
}

export interface GenerateRequest {
  prompt: string;
  width: number;
  height: number;
  workflow_json: string;
  params: Record<string, unknown>;
  type: string;
  client_id: string;
  convert_to_jpg: boolean;
}

export interface CanvasCreateRequest {
  title: string;
  icon: string;
  kind: 'classic' | 'smart';
}

export interface CanvasSaveRequest {
  title: string;
  icon: string;
  nodes: Record<string, unknown>[];
  connections: Record<string, unknown>[];
  viewport: Record<string, unknown>;
  logs: Record<string, unknown>[];
  settings: Record<string, unknown>;
  client_id: string;
  base_updated_at: number;
}

export interface ApiProviderPayload {
  id: string;
  name: string;
  base_url: string;
  protocol: string;
  image_generation_endpoint: string;
  image_edit_endpoint: string;
  enabled: boolean;
  primary: boolean;
  image_models: string[];
  chat_models: string[];
  video_models: string[];
  ms_loras: Record<string, unknown>[];
  ms_defaults_version: number;
  rh_apps: Record<string, unknown>[];
  rh_workflows: Record<string, unknown>[];
  api_key?: string;
  wallet_api_key?: string;
  clear_key: boolean;
  clear_wallet_key: boolean;
}

export interface AppInfo {
  version: string;
  repo_url: string;
  version_url: string;
}

export interface HistoryItem {
  timestamp: number;
  type: string;
  images: string[];
  prompt: string;
  model: string;
  [key: string]: unknown;
}
