export interface AdminConfig {
  tenantId: string;
  clientId: string;
  hostedOrigin: string;
}

export interface AdminEnvironment {
  VITE_ADMIN_TENANT_ID?: string;
  VITE_ADMIN_CLIENT_ID?: string;
  VITE_ADMIN_HOSTED_ORIGIN?: string;
  VITE_TENANT_LABEL?: string;
  VITE_WORKSPACE_LABEL?: string;
}

export class AdminConfigError extends Error {
  constructor(readonly code: 'AdminConfigurationRequired' | 'InvalidAdminConfiguration', message: string) {
    super(message);
    this.name = 'AdminConfigError';
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

export function readAdminConfig(env: AdminEnvironment = import.meta.env): AdminConfig {
  const required = {
    VITE_ADMIN_TENANT_ID: env.VITE_ADMIN_TENANT_ID?.trim() ?? '',
    VITE_ADMIN_CLIENT_ID: env.VITE_ADMIN_CLIENT_ID?.trim() ?? '',
    VITE_ADMIN_HOSTED_ORIGIN: env.VITE_ADMIN_HOSTED_ORIGIN?.trim() ?? '',
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([field]) => field);
  if (missing.length) {
    throw new AdminConfigError(
      'AdminConfigurationRequired',
      `Admin sign-in setup is required. Set ${missing.join(', ')} in packages/frontend/.env, then rebuild and redeploy. Rayfin manages .env.local.`,
    );
  }
  for (const field of ['VITE_ADMIN_TENANT_ID', 'VITE_ADMIN_CLIENT_ID'] as const) {
    if (!GUID.test(required[field]) || required[field] === EMPTY_GUID) {
      throw new AdminConfigError('InvalidAdminConfiguration', `${field} must be a valid, non-zero GUID. Update packages/frontend/.env, then rebuild and redeploy.`);
    }
  }

  const hostedOrigin = required.VITE_ADMIN_HOSTED_ORIGIN;
  let url: URL | undefined;
  try { url = new URL(hostedOrigin); } catch { /* Report a configuration error without reflecting the configured value. */ }
  const localhostHttp = url?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!url || url.origin !== hostedOrigin || url.username || url.password ||
    (url.protocol !== 'https:' && !localhostHttp)) {
    throw new AdminConfigError(
      'InvalidAdminConfiguration',
      'VITE_ADMIN_HOSTED_ORIGIN must be a canonical HTTPS origin without a path, query, hash, credentials, or trailing slash. HTTP is allowed only for localhost or 127.0.0.1 development.',
    );
  }
  return {
    tenantId: required.VITE_ADMIN_TENANT_ID.toLowerCase(),
    clientId: required.VITE_ADMIN_CLIENT_ID.toLowerCase(),
    hostedOrigin,
  };
}

export function getAdminSetup() {
  try {
    return { ready: true as const, config: readAdminConfig() };
  } catch (error) {
    if (!(error instanceof AdminConfigError)) throw error;
    return { ready: false as const, error };
  }
}

export function getInventoryLabels(env: AdminEnvironment = import.meta.env) {
  return {
    tenant: env.VITE_TENANT_LABEL?.trim() || 'Your tenant',
    workspace: env.VITE_WORKSPACE_LABEL?.trim() || 'Fabric workspace',
  };
}
