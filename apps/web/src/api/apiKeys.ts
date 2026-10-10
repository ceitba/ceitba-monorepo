import { apiGet, apiSend } from './client'

// The signed-in user's API keys (/v1/auth/api-keys, apps/api/docs/AUTH-SETUP.md
// "User API keys"). The MCP server's OAuth sign-ins show up here too, named
// "MCP · <client>"; revoking one disconnects that assistant.

export type ApiKeyScope = 'read' | 'report' | 'write' | 'staff'

export interface ApiKey {
  id: string
  name: string
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  scopes: ApiKeyScope[]
}

export interface CreatedApiKey {
  id: string
  name: string
  // The raw key: returned once, never again.
  key: string
  expiresAt: string
  scopes: ApiKeyScope[]
}

export function fetchApiKeys(): Promise<ApiKey[]> {
  return apiGet<ApiKey[]>('/auth/api-keys')
}

export function createApiKey(body: { name: string; ttlDays: number; scopes: ApiKeyScope[] }): Promise<CreatedApiKey> {
  return apiSend<CreatedApiKey>('POST', '/auth/api-keys', body)
}

export function revokeApiKey(id: string): Promise<void> {
  return apiSend<void>('DELETE', `/auth/api-keys/${encodeURIComponent(id)}`)
}
