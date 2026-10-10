import { apiGet, apiSend } from './client'

// The signed-in user's API keys (/v1/auth/api-keys, apps/api/docs/AUTH-SETUP.md
// "User API keys"). The MCP server's OAuth sign-ins are keys named
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

export function fetchApiKeys(): Promise<ApiKey[]> {
  return apiGet<ApiKey[]>('/auth/api-keys')
}

export function revokeApiKey(id: string): Promise<void> {
  return apiSend<void>('DELETE', `/auth/api-keys/${encodeURIComponent(id)}`)
}
