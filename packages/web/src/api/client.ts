// @MX:ANCHOR: [AUTO] API 클라이언트 - 모든 백엔드 API 호출의 단일 진입점
// @MX:REASON: 모든 페이지에서 사용하며 fan_in >= 8

const BASE = '/admin/api';

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...options.headers as Record<string, string>,
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string }; message?: string };
    throw new Error(body.error?.message ?? body.message ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}

// --- Types ---

export interface StatusResponse {
  initialized: boolean;
}

export interface SetupRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface UserResponse {
  username: string;
  role: string;
}

export interface Vault {
  id: string;
  name: string;
  created_at: string;
  created_by: string | null;
}

export interface VaultCreateRequest {
  name: string;
}

export interface VaultCreateResponse {
  id: string;
  name: string;
}

export interface VaultFile {
  path: string;
  size: number;
  updated_at: string;
  file_type: string;
}

export interface VaultFileContent {
  path: string;
  content: string;
  size: number;
  updated_at: string;
  file_type: string;
}

// --- API Functions ---

export function getStatus(): Promise<StatusResponse> {
  return request<StatusResponse>('/status');
}

export function setup(data: SetupRequest): Promise<UserResponse> {
  return request<UserResponse>('/setup', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function login(data: LoginRequest): Promise<UserResponse> {
  return request<UserResponse>('/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function logout(): Promise<void> {
  return request<void>('/logout', { method: 'POST' });
}

export function getMe(): Promise<UserResponse> {
  return request<UserResponse>('/me');
}

export function getVaults(): Promise<Vault[]> {
  return request<Vault[]>('/vaults');
}

export function createVault(
  data: VaultCreateRequest,
): Promise<VaultCreateResponse> {
  return request<VaultCreateResponse>('/vaults', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getVaultFiles(vaultId: string): Promise<VaultFile[]> {
  return request<VaultFile[]>(`/vaults/${vaultId}/files`);
}

export function getVaultFileContent(
  vaultId: string,
  filePath: string,
): Promise<VaultFileContent> {
  const encoded = encodeURIComponent(filePath);
  return request<VaultFileContent>(`/vaults/${vaultId}/file/${encoded}`);
}

export function deleteVault(vaultId: string): Promise<void> {
  return request<void>(`/vaults/${vaultId}`, { method: 'DELETE' });
}

// @MX:NOTE 첨부파일 URL 생성 - 바이너리 파일 조회용 URL 반환
export function getVaultAttachmentUrl(vaultId: string, filePath: string): string {
  return `${BASE}/vaults/${vaultId}/attachment/${encodeURIComponent(filePath)}`;
}
