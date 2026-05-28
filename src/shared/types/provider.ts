export type ProviderProtocol = 'openai' | 'apimart' | 'gemini' | 'volcengine' | 'runninghub';

export interface ProviderInfo {
  id: string;
  name: string;
  base_url: string;
  protocol: ProviderProtocol;
  image_generation_endpoint: string;
  image_edit_endpoint: string;
  enabled: boolean;
  primary: boolean;
  image_models: string[];
  chat_models: string[];
  video_models: string[];
}

export interface ComfyUIInstance {
  address: string;
  prompt_id: string;
}

export interface WorkflowInfo {
  name: string;
  path: string;
  fields: WorkflowField[];
  config?: WorkflowConfig;
}

export interface WorkflowField {
  key: string;
  label: string;
  type: string;
  default: unknown;
  options: string[];
  required: boolean;
}

export interface WorkflowConfig {
  fields: WorkflowField[];
}
