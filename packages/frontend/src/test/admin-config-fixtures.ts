import { vi } from 'vitest';

// Fictional public identifiers and reserved hostnames for tests only.
export const syntheticTenantId = '33333333-3333-4333-8333-333333333333';
export const syntheticClientId = '55555555-5555-4555-8555-555555555555';
export const syntheticHostedOrigin = 'https://inventory.example.test';
export const syntheticAdminEnvironment = {
  VITE_ADMIN_TENANT_ID: syntheticTenantId,
  VITE_ADMIN_CLIENT_ID: syntheticClientId,
  VITE_ADMIN_HOSTED_ORIGIN: syntheticHostedOrigin,
};

export function configureSyntheticAdminEnvironment() {
  for (const [key, value] of Object.entries(syntheticAdminEnvironment)) vi.stubEnv(key, value);
  vi.stubEnv('VITE_TENANT_LABEL', '');
  vi.stubEnv('VITE_WORKSPACE_LABEL', '');
}
