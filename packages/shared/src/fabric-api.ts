import type {
  ApiFailure, ApiResult, ConnectionOwner, ConnectionPage, ConnectionRecord, OwnerBatch,
} from './index.js';

const API_ROOT = 'https://api.fabric.microsoft.com/v1/admin/connections';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export class InventoryError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}

function invalidResponse(): never {
  throw new InventoryError({
    code: 'InvalidApiResponse',
    message: 'Fabric returned an unexpected response. No incomplete page has been treated as complete.',
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

function text(value: unknown, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) invalidResponse();
    return undefined;
  }
  if (typeof value !== 'string' || value.length > 32_768) invalidResponse();
  return value;
}

function child(value: unknown): Record<string, unknown> {
  return value === undefined || value === null ? {} : object(value);
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalidResponse();
  return value;
}

function page(value: unknown): { values: unknown[]; nextToken: string | null } {
  const body = object(value);
  if (!Array.isArray(body.value) || body.value.length > 10_000) invalidResponse();
  const nextToken = text(body.continuationToken) || null;
  if (body.continuationUri && !nextToken) {
    throw new InventoryError({
      code: 'MissingContinuationToken',
      message: 'Fabric returned a continuation URI without a token. Enumeration stopped to avoid missing records.',
    });
  }
  return { values: body.value, nextToken };
}

export function connection(value: unknown): ConnectionRecord {
  const row = object(value);
  const details = child(row.connectionDetails);
  const credentials = child(row.credentialDetails);
  const recency = child(row.connectionRecency);
  return {
    id: identifier(row.id),
    displayName: text(row.displayName) || '(unnamed connection)',
    connectorType: text(details.type) || 'Not returned',
    connectivityType: text(row.connectivityType) || 'Not returned',
    endpoint: text(details.path) || 'Not returned',
    privacyLevel: text(row.privacyLevel),
    gatewayId: text(row.gatewayId),
    credentialType: text(credentials.credentialType),
    createdDateTime: text(recency.createdDateTime),
    lastCredentialUsedDateTime: text(recency.lastCredentialUsedDateTime),
  };
}

function owner(value: unknown): ConnectionOwner | null {
  const assignment = object(value);
  const role = text(assignment.role, true);
  if (role !== 'Owner' && role !== 'PendingOwner') return null;
  const principal = object(assignment.principal);
  return {
    id: identifier(principal.id),
    type: text(principal.type, true)!,
    displayName: text(principal.displayName),
    userPrincipalName: text(child(principal.userDetails).userPrincipalName),
    role,
  };
}

export async function safeResult<T>(operation: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    const data = await operation();
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_OUTPUT_BYTES) {
      throw new InventoryError({
        code: 'OutputTooLarge',
        message: 'This API result exceeds the app response limit. No truncated result was returned.',
      });
    }
    return { ok: true, data };
  } catch (error) {
    const failure: ApiFailure = error instanceof InventoryError ? error.failure : {
      code: 'UnexpectedFailure',
      message: 'The inventory request failed unexpectedly. Retry or check the Fabric API permissions.',
    };
    console.error('Connection inventory failure', failure.code, failure.status ?? '');
    return { ok: false, error: failure };
  }
}

export function requireTenantAdminToken(getToken: () => string, expectedTenantId: string): string {
  if (typeof expectedTenantId !== 'string' || !UUID.test(expectedTenantId) ||
    expectedTenantId === '00000000-0000-0000-0000-000000000000') {
    throw new InventoryError({
      code: 'InvalidTenantConfiguration',
      message: 'A valid, non-zero expected tenant GUID is required before requesting a Fabric resource token.',
    });
  }
  let token: string;
  try {
    token = getToken();
  } catch {
    throw new InventoryError({
      code: 'FabricTokenUnavailable',
      message: 'The Fabric access token is unavailable. Connect the dedicated admin account again.',
    });
  }
  let claims: unknown;
  try {
    const encoded = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, (value) => value.charCodeAt(0))));
  } catch {
    throw new InventoryError({ code: 'InvalidResourceToken', message: 'The Fabric resource token could not be inspected for the configured tenant guard.' });
  }
  // Fabric validates the token; these checks only prevent wrong-tenant or wrong-scope requests.
  const metadata = object(claims);
  if (typeof metadata.tid !== 'string' || metadata.tid.toLowerCase() !== expectedTenantId.toLowerCase()) {
    throw new InventoryError({ code: 'WrongTenant', message: 'This app is restricted to its configured tenant. Connect a tenant administrator account in that directory.' });
  }
  if (typeof metadata.scp === 'string') {
    const scopes = metadata.scp.split(/\s+/);
    if (!scopes.includes('Tenant.Read.All')) {
      throw new InventoryError({
        code: 'AdminScopeMissing',
        message: 'Admin sign-in did not grant Tenant.Read.All. Reconnect using the dedicated app and confirm its delegated tenant-read consent. Changing connection ownership will not fix this.',
      });
    }
  } else {
    throw new InventoryError({ code: 'DelegatedTokenRequired', message: 'This app requires a delegated administrator sign-in, not an application-only token.' });
  }
  return token;
}

export class FabricInventory {
  private readonly deadline: number;
  private retryAt = 0;

  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly abortSignal?: AbortSignal,
  ) {
    this.deadline = now() + 120_000;
  }

  private async get(path: string, continuationToken: string): Promise<unknown> {
    if (typeof continuationToken !== 'string' || continuationToken.length > 32_768) {
      throw new InventoryError({ code: 'InvalidInput', message: 'The continuation token is invalid.' });
    }
    const url = new URL(API_ROOT + path);
    if (continuationToken) url.searchParams.set('continuationToken', continuationToken);
    for (let attempt = 0; attempt < 3; attempt++) {
      this.abortSignal?.throwIfAborted();
      const delay = Math.max(0, this.retryAt - this.now());
      if (this.now() + delay + 1_000 >= this.deadline) {
        throw new InventoryError({ code: 'RetryBudgetExceeded', message: 'Fabric requested more wait time than this request batch allows. Wait and refresh the inventory.' });
      }
      if (delay) await this.sleep(delay);
      this.abortSignal?.throwIfAborted();
      let response: Response;
      try {
        const request = this.request;
        response = await request(url.href, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
          redirect: 'error',
          credentials: 'omit',
          signal: this.abortSignal ?
            AbortSignal.any([this.abortSignal, AbortSignal.timeout(Math.min(25_000, this.deadline - this.now()))]) :
            AbortSignal.timeout(Math.min(25_000, this.deadline - this.now())),
        });
      } catch (error) {
        throw new InventoryError({
          code: error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'RequestTimeout' : 'NetworkError',
          message: 'The Fabric API could not be reached within the request deadline. Retry the inventory.',
        });
      }
      const requestId = response.headers.get('request-id') ?? response.headers.get('requestid') ??
        response.headers.get('x-ms-request-id') ?? undefined;
      if ((response.status === 429 || response.status === 503) && attempt < 2) {
        const retryAfter = response.headers.get('retry-after');
        if (response.status === 429 && !retryAfter) {
          await response.body?.cancel();
          throw new InventoryError({
            code: 'FabricHttp429',
            message: 'Fabric is throttling requests. Its Retry-After header is not exposed to this browser, so automatic retries have stopped. Wait before refreshing again.',
            status: 429,
            requestId,
          });
        }
        const seconds = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : NaN;
        const retryMs = Number.isFinite(seconds) ? seconds * 1_000 :
          retryAfter && Number.isFinite(Date.parse(retryAfter)) ? Math.max(0, Date.parse(retryAfter) - this.now()) : 1_000 * 2 ** attempt;
        this.retryAt = Math.max(this.retryAt, this.now() + retryMs);
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const message = response.status === 403 ?
          'Access denied. Your signed-in account must be a Fabric administrator and have delegated Tenant.Read.All consent for this app.' :
          response.status === 401 ? 'Fabric rejected the resource token. Check its audience, expiry, consent, and the admin API identity requirements.' :
          response.status === 404 ? 'This connection or admin API was not found. The connection may have been deleted, or the preview API may be unavailable.' :
          response.status === 429 ? 'Fabric is throttling requests. Wait before refreshing the inventory.' :
          `Fabric returned HTTP ${response.status}. Retry or use the request ID to investigate.`;
        throw new InventoryError({ code: `FabricHttp${response.status}`, message, status: response.status, requestId });
      }
      if (!response.body) invalidResponse();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let responseText = '';
      let size = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new InventoryError({ code: 'ResponseTooLarge', message: 'The Fabric API response exceeded the safe read limit. No partial page was accepted.' });
          }
          responseText += decoder.decode(result.value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(responseText + decoder.decode()) as unknown;
      } catch {
        invalidResponse();
      }
    }
    throw new InventoryError({ code: 'RetryLimitExceeded', message: 'Fabric remained unavailable after bounded retries.' });
  }

  async listConnections(continuationToken: string): Promise<ConnectionPage> {
    const result = page(await this.get('', continuationToken));
    return { connections: result.values.map(connection), nextToken: result.nextToken };
  }

  private async listOwners(connectionId: string): Promise<ConnectionOwner[]> {
    const owners = new Map<string, ConnectionOwner>();
    const tokens = new Set<string>();
    let token = '';
    for (let index = 0; index < 100; index++) {
      const result = page(await this.get(`/${connectionId}/roleAssignments`, token));
      for (const value of result.values) {
        const principal = owner(value);
        if (principal) owners.set(`${principal.type}:${principal.id}:${principal.role}`, principal);
      }
      if (!result.nextToken) return [...owners.values()];
      if (tokens.has(result.nextToken)) {
        throw new InventoryError({ code: 'PaginationLoop', message: 'Fabric repeated an ownership continuation token. Owner results are incomplete.' });
      }
      tokens.add(result.nextToken);
      token = result.nextToken;
    }
    throw new InventoryError({ code: 'PageLimitExceeded', message: 'Owner enumeration reached the 100-page safety limit. Owner results are incomplete.' });
  }

  async listConnectionOwners(connectionIds: string[]): Promise<OwnerBatch> {
    if (!Array.isArray(connectionIds) || connectionIds.length < 1 || connectionIds.length > 6 ||
        connectionIds.some((id) => typeof id !== 'string' || !UUID.test(id)) ||
        new Set(connectionIds).size !== connectionIds.length) {
      throw new InventoryError({ code: 'InvalidInput', message: 'Supply between one and six unique connection UUIDs.' });
    }
    const results: OwnerBatch['results'] = [];
    for (let start = 0; start < connectionIds.length; start += 3) {
      results.push(...await Promise.all(connectionIds.slice(start, start + 3).map(async (connectionId) => ({
        connectionId,
        result: await safeResult(() => this.listOwners(connectionId)),
      }))));
    }
    return { results };
  }
}
