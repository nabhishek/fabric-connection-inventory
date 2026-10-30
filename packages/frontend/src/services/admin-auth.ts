import {
  AuthError, BrowserCacheLocation, InteractionRequiredAuthError, PublicClientApplication,
  type AccountInfo, type AuthenticationResult,
} from '@azure/msal-browser';
import { InventoryError, requireTenantAdminToken } from '@rayfin-app/shared';
import { AdminConfigError, readAdminConfig, type AdminConfig } from './admin-config';

export interface AdminSession {
  username: string;
  tenantId: string;
}

export class AdminAuthError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export const ADMIN_SCOPE = 'https://api.fabric.microsoft.com/Tenant.Read.All';
let client: Promise<PublicClientApplication> | undefined;
let account: AccountInfo | null = null;
let generation = 0;

function getClient(config: AdminConfig): Promise<PublicClientApplication> {
  if (window.location.origin !== config.hostedOrigin) {
    throw new AdminAuthError('UnregisteredOrigin', 'Admin sign-in is available only at the configured origin. Open the configured inventory to connect.');
  }
  client ??= (async () => {
    const instance = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: `${config.hostedOrigin}/admin-auth.html`,
        ...(window.top !== window.self ? { popupRelayUri: `${config.hostedOrigin}/admin-auth-relay.html` } : {}),
      },
      cache: { cacheLocation: BrowserCacheLocation.MemoryStorage },
      system: {
        popupBridgeTimeout: 300_000,
        loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => undefined },
      },
    });
    await instance.initialize();
    return instance;
  })().catch((error: unknown) => {
    client = undefined;
    throw error;
  });
  return client;
}

function validateResult(result: AuthenticationResult, config: AdminConfig): AccountInfo {
  if (!result.account || result.account.tenantId.toLowerCase() !== config.tenantId) {
    throw new AdminAuthError('WrongTenant', 'Connect an administrator account in the configured tenant.');
  }
  requireTenantAdminToken(() => result.accessToken, config.tenantId);
  return result.account;
}

function authFailure(error: unknown): AdminAuthError {
  if (error instanceof AdminAuthError) return error;
  if (error instanceof AdminConfigError) return new AdminAuthError(error.code, error.message);
  if (error instanceof InventoryError) return new AdminAuthError(error.failure.code, error.failure.message);
  if (error instanceof InteractionRequiredAuthError) {
    return new AdminAuthError('AdminSignInRequired', 'Your admin session needs attention. Reconnect the admin account to continue.');
  }
  const code = error instanceof AuthError && /^[a-z0-9_]+$/i.test(error.errorCode) ? error.errorCode : 'SignInFailed';
  return new AdminAuthError(code, code === 'user_cancelled' ?
    'Admin sign-in was cancelled. No inventory request was made.' :
    `Microsoft admin sign-in failed (${code}). Allow popups, verify consent, and reconnect.`);
}

export function getAdminSession(): AdminSession | null {
  try {
    const config = readAdminConfig();
    return account?.tenantId.toLowerCase() === config.tenantId ?
      { username: account.username, tenantId: account.tenantId } : null;
  } catch {
    return null;
  }
}

export async function signInAdmin(): Promise<AdminSession> {
  const currentGeneration = generation;
  try {
    const config = readAdminConfig();
    const instance = await getClient(config);
    const result = await instance.loginPopup({
      scopes: [ADMIN_SCOPE], prompt: 'select_account',
    });
    if (generation !== currentGeneration) {
      await instance.clearCache();
      throw new AdminAuthError('SignInCancelled', 'This sign-in was superseded. Connect again when ready.');
    }
    account = validateResult(result, config);
    instance.setActiveAccount(account);
    return { username: account.username, tenantId: account.tenantId };
  } catch (error) {
    throw authFailure(error);
  }
}

export async function getAdminAccessToken(): Promise<string> {
  try {
    const config = readAdminConfig();
    if (!account) throw new AdminAuthError('AdminSignInRequired', 'Connect an admin account in the configured tenant before loading the inventory.');
    const currentGeneration = generation;
    const instance = await getClient(config);
    const result = await instance.acquireTokenSilent({ account, scopes: [ADMIN_SCOPE] });
    if (generation !== currentGeneration) throw new AdminAuthError('AdminSignInRequired', 'The admin account was disconnected.');
    validateResult(result, config);
    return result.accessToken;
  } catch (error) {
    throw authFailure(error);
  }
}

export async function disconnectAdmin(): Promise<void> {
  generation++;
  account = null;
  if (client) {
    const instance = await client;
    instance.setActiveAccount(null);
    await instance.clearCache();
  }
}
