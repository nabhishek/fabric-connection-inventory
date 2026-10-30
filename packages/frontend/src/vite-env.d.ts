/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Required single-tenant Entra directory GUID. */
  readonly VITE_ADMIN_TENANT_ID?: string;
  /** Required Entra SPA application GUID; never a client secret. */
  readonly VITE_ADMIN_CLIENT_ID?: string;
  /** Required canonical HTTPS hosting origin, or HTTP localhost/127.0.0.1 for development. */
  readonly VITE_ADMIN_HOSTED_ORIGIN?: string;
  /** Optional cosmetic labels, not authorization or data-source selectors. */
  readonly VITE_TENANT_LABEL?: string;
  readonly VITE_WORKSPACE_LABEL?: string;
  /** Rayfin API base URL (e.g. http://localhost:5168). */
  readonly VITE_RAYFIN_API_URL?: string;
  /** Rayfin publishable key (pk-...). */
  readonly VITE_RAYFIN_PUBLISHABLE_KEY?: string;
  /** Fabric workspace ID — maps to FabricAuthOptions.workspaceId. */
  readonly VITE_FABRIC_WORKSPACE_ID?: string;
  /** Fabric/Rayfin item ID — maps to FabricAuthOptions.projectId. */
  readonly VITE_FABRIC_ITEM_ID?: string;
  /** Fabric portal base URL (e.g. https://app.fabric.microsoft.com/). */
  readonly VITE_FABRIC_PORTAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
