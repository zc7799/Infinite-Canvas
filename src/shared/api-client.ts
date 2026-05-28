type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
};

async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, signal } = options;
  const init: RequestInit = { method, headers, signal };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, init);
  if (!response.ok) {
    const detail = await response.text();
    let message = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(detail);
      message = parsed.detail || message;
    } catch {
      message = detail || message;
    }
    throw new Error(message);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : ({} as T);
}

export function get<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal });
}

export function post<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'POST', body, signal });
}

export function del<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'DELETE', body });
}

export function uploadFile<T = unknown>(
  path: string,
  file: File,
  fieldName: string = 'file',
  extraFields: Record<string, string> = {},
): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);
  for (const [key, val] of Object.entries(extraFields)) {
    formData.append(key, val);
  }
  return fetch(path, { method: 'POST', body: formData }).then(async (res) => {
    if (!res.ok) {
      const detail = await res.text();
      let message = `HTTP ${res.status}`;
      try {
        message = JSON.parse(detail).detail || message;
      } catch {
        message = detail || message;
      }
      throw new Error(message);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : ({} as T);
  });
}

export async function streamSSE(
  path: string,
  body: unknown,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `SSE request failed: ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      onDone();
      return;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            onDone();
            return;
          }
          onChunk(data);
        }
      }
    }
    onDone();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
