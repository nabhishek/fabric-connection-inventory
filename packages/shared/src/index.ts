/**
 * Entity map shared by the data registration package and typed browser client.
 *
 * It remains empty while the data service is disabled. Data capabilities add
 * entity keys here so every runtime consumes the same schema contract.
 */
export type UniversalAppSchema = Record<string, never>;

export { FabricInventory, InventoryError, requireTenantAdminToken, safeResult } from './fabric-api.js';

export interface ApiFailure {
  code: string;
  message: string;
  status?: number;
  requestId?: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiFailure };

export interface ConnectionRecord {
  id: string;
  displayName: string;
  connectorType: string;
  connectivityType: string;
  endpoint: string;
  privacyLevel?: string;
  gatewayId?: string;
  credentialType?: string;
  createdDateTime?: string;
  lastCredentialUsedDateTime?: string;
}

export interface ConnectionOwner {
  id: string;
  type: string;
  displayName?: string;
  userPrincipalName?: string;
  role: 'Owner' | 'PendingOwner';
}

export interface ConnectionRow extends ConnectionRecord {
  owners: ConnectionOwner[];
  ownerStatus: 'pending' | 'loaded' | 'error';
  ownerError?: ApiFailure;
}

export interface ConnectionPage {
  connections: ConnectionRecord[];
  nextToken: string | null;
}

export interface OwnerLookup {
  connectionId: string;
  result: ApiResult<ConnectionOwner[]>;
}

export interface OwnerBatch {
  results: OwnerLookup[];
}

export interface InventorySnapshot {
  connections: ConnectionRow[];
  inventoryComplete: boolean;
  phase: 'connections' | 'owners' | 'done' | 'error';
  updatedAt: string | null;
  error?: ApiFailure;
}

export interface LoadInventoryOptions {
  signal: AbortSignal;
  onProgress: (snapshot: InventorySnapshot) => void;
}
