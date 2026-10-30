# Fabric Connection Inventory

A read-only Microsoft Fabric App, built with Rayfin, for tenant administrators
to enumerate connections, owners, connector types, and endpoint paths.

This repository is a **single-tenant deployment template**, not a shared
multitenant service. Each organization deploys its own Fabric App and configures
its own Microsoft Entra registration. No live tenant configuration, credentials,
connection inventory, or previous deployment records are included.

## Features

- Tenant-wide connection inventory with independent owner-role pagination.
- Search by name, ID, owner, connector type, or endpoint.
- Connector and owner-status filters, sorting, details, and 25-row display pages.
- All `Owner` and `PendingOwner` assignments, with pending ownership labeled.
- Clear distinction between empty owner results, failed lookups, and unread rows.
- Refresh, cancellation, responsive layout, and light/dark themes.
- Bounded requests and retries; no automatic retry when CORS hides a throttled
  response's `Retry-After` header.

The app only calls:

```text
GET https://api.fabric.microsoft.com/v1/admin/connections
GET https://api.fabric.microsoft.com/v1/admin/connections/{id}/roleAssignments
```

It never changes connections, ownership, credentials, or source data, and never
contacts the displayed endpoints.

## Requirements

- Node.js 24 and npm.
- Access to the Fabric Apps/Rayfin preview npm packages through an approved npm
  registry. Registry credentials and machine-specific registry configuration are
  not included in this repository.
- A Fabric workspace on an available capacity in a supported region, with the
  Fabric Apps workload enabled.
- Permission to create/deploy Fabric Apps in that workspace.
- A Microsoft Entra administrator who can register a single-tenant SPA and
  approve delegated `Tenant.Read.All`.
- A Fabric administrator account to use the tenant inventory APIs.

## Deploy in your tenant

### 1. Install and create the Fabric App

```sh
npm ci
npx rayfin login --tenant <your-tenant-id>
npx rayfin login status
npx rayfin up --dry-run --workspace-id <your-workspace-id> --json
npx rayfin up --workspace-id <your-workspace-id> --json
```

Confirm the signed-in account and target workspace before deploying. Do not copy
another deployment's `.env`, `.env.local`, or `rayfin/.deployments.json`.
The CLI returns your app's hosting URL and Fabric item link.

The initial deployment can render without administrator sign-in configuration,
but it cannot enumerate a tenant until the configuration below is supplied.
Do not treat this bootstrap deployment as a fully configured app.

### 2. Register dedicated administrator sign-in

In the Microsoft Entra admin center for your tenant:

1. Register an application with **Accounts in this organizational directory only**.
2. Select the **Single-page application (SPA)** platform and register this exact
   redirect URI, replacing the origin with the hosting URL from step 1:
   `https://<your-app-host>/admin-auth.html`.
3. Add **Power BI Service -> Delegated permissions -> Tenant.Read.All** and grant
   the required administrator consent. Remove unused default permissions such as
   Microsoft Graph `User.Read` if they were added by the registration wizard.
4. Record the application/client ID and directory/tenant ID.

Do not create a client secret or enable implicit token issuance. MSAL uses the
authorization-code flow with PKCE. The app requests
`https://api.fabric.microsoft.com/Tenant.Read.All` and standard OIDC sign-in and
renewal scopes.

Consent does not make a user a tenant administrator. Fabric checks the signed-in
user's role and permissions on each API request.

### 3. Configure and redeploy

```sh
cp packages/frontend/.env.example packages/frontend/.env
```

Fill in the file:

| Variable | Required | Meaning |
|---|---|---|
| `VITE_ADMIN_TENANT_ID` | Yes | Your Microsoft Entra tenant UUID |
| `VITE_ADMIN_CLIENT_ID` | Yes | Your SPA registration's application/client UUID |
| `VITE_ADMIN_HOSTED_ORIGIN` | Yes | Exact app origin, such as `https://<your-app-host>`; no path, query, or fragment |
| `VITE_TENANT_LABEL` | No | Friendly tenant label displayed in the UI |
| `VITE_WORKSPACE_LABEL` | No | Friendly Fabric workspace label displayed in the UI |

These are public application identifiers, not secrets. Never put passwords,
client secrets, or access tokens in any `VITE_*` setting.
Use `.env`, not `.env.local`: the Rayfin CLI generates `.env.local` for its own
hosting and authentication settings.

```sh
npm run typecheck
npm run build
npm run lint
npm test
npx rayfin up --dry-run --workspace-id <your-workspace-id> --json
npx rayfin up --workspace-id <your-workspace-id> --json
```

Open the Fabric item, choose **Connect admin account**, then select **Continue
to Microsoft sign-in** in the temporary authentication window. Select an
administrator in your configured tenant. The authentication windows close after
sign-in and the inventory appears inside the Fabric App. The standalone hosting
URL also works. Confirm that the live inventory and owner lookups complete.

### Optional local development

For administrator sign-in locally, explicitly register
`http://localhost:5173/admin-auth.html` as an additional SPA redirect URI and use
`http://localhost:5173` as the configured origin in your local `.env`.
HTTP is accepted only for loopback development origins.

```sh
npm run dev -- --workspace-id <your-workspace-id>
```

This starts the official Rayfin development flow, which can create or configure
the backend in the explicit workspace. Review its target before approving a
first-time create. Restore the production origin and redeploy before distributing
the hosted application.

## Authentication and data boundaries

The outer Fabric AuthGate and protected static hosting remain enabled.
Administrator API requests use **each signed-in user's delegated token**, not an
app-owner token or a service principal. Database, storage, and Functions services
are disabled.

MSAL holds the administrator session in memory only. Reloading may require a new
explicit connection. Disconnect immediately clears the inventory and the app's
administrator cache without globally signing the user out of Microsoft.
Token renewal never opens an unexpected sign-in popup.

The configured tenant and origin are enforced before requests. Missing or
invalid authentication configuration fails closed; the template never falls back
to another tenant.

The MSAL redirect bridge and popup relay are bundled on the app's origin. They must be
served with `Cache-Control: no-store` and without a
`Cross-Origin-Opener-Policy` header that would break popup communication. Verify
these response headers in your deployment. Keep the bridge outside React's
authentication gates.

Embedded views use MSAL 5's supported `popupRelayUri` flow. The same-origin relay
opens Microsoft sign-in after a user gesture and returns the authorization
response to the embedded app; MSAL validates the response's source, origin, and
state. The PKCE verifier and access tokens remain in the app frame. Relay
navigation is pinned to `https://login.microsoftonline.com`. Only authentication
uses temporary windows; the inventory remains in Fabric. The relay page is not
a new OAuth callback and needs no additional Entra redirect URI.

Results remain in the current browser's memory. There is no app database,
automatic export, or committed inventory. Sequential API reads are not an atomic
snapshot; connections may change during enumeration.

## Interpreting results

- The endpoint is `connectionDetails.path`. Some connectors return a logical
  label instead of a server URL.
- Names and user principal names are shown only when the API returns them.
  Otherwise, the principal ID and type remain visible; names are not guessed.
- "No owners returned" describes the role-assignment response. It is not proof
  that a connection is orphaned.
- Missing display names and metadata are marked explicitly.
- Partial results remain visibly incomplete. Unread or failed owner lookups never
  appear as successful empty results.
- Rapid repeated refreshes can trigger Fabric limits. If the browser cannot read
  `Retry-After`, the app stops further batches and asks you to wait rather than
  guessing a delay.

## Project layout and checks

```text
packages/frontend/       React UI, protected app shell, MSAL sign-in and orchestration
packages/shared/         Browser-safe API client, contracts and API tests
packages/data/           Empty schema retained by the official Rayfin template
rayfin/rayfin.yml        Protected Fabric App service configuration
```

```sh
npm run typecheck
npm run build
npm run lint
npm test
```

Tests use synthetic fixtures. A clean build does not prove that a new tenant has
granted the required consent or that its administrator has API access; verify the
deployed app with that tenant's account.

## Sharing and license

Share this source repository with another organization so it can deploy a
separate instance following the steps above. Sharing a hosting URL does not
grant administrator access or convert the app into a multitenant service.

This project is derived from Microsoft's MIT-licensed Rayfin starter and retains
its copyright and license notices. See [LICENSE](LICENSE).

## Documentation

- [Fabric Apps overview](https://learn.microsoft.com/en-us/fabric/apps/overview)
- [Rayfin CLI deployment](https://learn.microsoft.com/en-us/fabric/apps/create-app-with-cli)
- [Admin List Connections](https://learn.microsoft.com/en-us/rest/api/fabric/admin/connections/list-connections)
- [Admin List Connection Role Assignments](https://learn.microsoft.com/en-us/rest/api/fabric/admin/connections/list-connection-role-assignments)
- [Microsoft Entra SPA configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-configuration)
