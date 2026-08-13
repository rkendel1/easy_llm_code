export interface RuntimeTransport { readonly kind: "stdio" | "local-http" | "websocket" | "unix"; connect(): Promise<void>; request<T>(path: string, init?: RequestInit): Promise<T>; disconnect(): Promise<void> }
export class LocalHTTPRuntimeTransport implements RuntimeTransport {
  readonly kind = "local-http" as const; private connected = false; private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: { baseUrl: string; token: string; fetch?: typeof globalThis.fetch }) { this.fetcher = options.fetch ?? globalThis.fetch; }
  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.connected = false; }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> { if (!this.connected && path !== "/health") await this.connect(); const response = await this.fetcher(new URL(path, this.options.baseUrl), { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${this.options.token}`, ...init.headers } }); if (!response.ok) throw new Error(`RUNTIME_${response.status}: ${await response.text()}`); return response.status === 204 ? undefined as T : response.json() as Promise<T>; }
}
