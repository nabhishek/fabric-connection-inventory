//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowLeft, ArrowRight, Info, LoaderCircle, LogOut, RefreshCw, Search, ShieldCheck, X,
} from 'lucide-react';

import { ConnectionTable } from '@/components/inventory/connection-table';
import { InventoryHeader } from '@/components/inventory/inventory-header';
import { InventoryStatus } from '@/components/inventory/inventory-status';
import {
  formatTimestamp, PAGE_SIZE, selectConnections, summarizeInventory,
  type InventoryFilters, type InventorySort, type SortColumn,
} from '@/components/inventory/inventory-model';
import { useInventory } from '@/hooks/use-inventory';
import {
  disconnectAdmin, getAdminSession, signInAdmin, type AdminSession,
} from '@/services/admin-auth';
import { getAdminSetup, getInventoryLabels } from '@/services/admin-config';

const emptyFilters: InventoryFilters = { search: '', connectorType: '', ownerStatus: 'all' };

function App() {
  const [session, setSession] = useState<AdminSession | null>(() => getAdminSession());
  const [busy, setBusy] = useState<'connecting' | 'disconnecting' | null>(null);
  const [error, setError] = useState<{ action: 'connect' | 'disconnect'; message: string } | null>(null);
  const mounted = useRef(true);
  const operation = useRef(0);
  const embedded = window.top !== window.self;
  const setup = getAdminSetup();
  const labels = getInventoryLabels();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current += 1;
    };
  }, []);

  async function connect() {
    if (!setup.ready) return;
    const request = ++operation.current;
    // Unmount the inventory before changing account, while keeping popup auth in the click gesture.
    flushSync(() => {
      setSession(null);
      setBusy('connecting');
      setError(null);
    });
    try {
      const nextSession = await signInAdmin();
      if (mounted.current && operation.current === request) setSession(nextSession);
    } catch (failure) {
      if (mounted.current && operation.current === request) {
        setError({
          action: 'connect',
          message: failure instanceof Error && failure.name === 'AdminAuthError' ? failure.message :
            'Admin sign-in did not complete. Allow the Microsoft sign-in popup, use an administrator account in the configured tenant, and try again. An administrator may need to consent to Tenant.Read.All.',
        });
      }
    } finally {
      if (mounted.current && operation.current === request) setBusy(null);
    }
  }

  async function disconnect() {
    const request = ++operation.current;
    // The effect cleanup aborts inventory work before the in-memory auth cache is cleared.
    flushSync(() => {
      setSession(null);
      setBusy('disconnecting');
      setError(null);
    });
    try {
      await disconnectAdmin();
    } catch {
      if (mounted.current && operation.current === request) {
        setError({
          action: 'disconnect',
          message: 'The inventory has been cleared, but this app’s admin session could not be cleared. Retry disconnecting or close this tab to discard the in-memory session.',
        });
      }
    } finally {
      if (mounted.current && operation.current === request) setBusy(null);
    }
  }

  if (session && setup.ready) {
    return <InventoryApp session={session} onDisconnect={disconnect} onReconnect={connect} />;
  }

  return (
    <div className="inventory-app min-h-full font-base text-300 leading-300">
      <a href="#admin-connect" className="inventory-skip-link">Skip to admin sign-in</a>
      <InventoryHeader />
      <main id="admin-connect" className="inventory-container py-800" tabIndex={-1}>
        <section className="inventory-panel mx-auto max-w-3xl space-y-600 p-600 sm:p-800" aria-labelledby="admin-title">
          <div className="space-y-300">
            <p className="inventory-eyebrow">CONNECTION GOVERNANCE</p>
            <h1 id="admin-title" className="text-hero-800 leading-hero-800 font-semibold">Connection inventory</h1>
            <p className="text-400 leading-400 text-muted-foreground">
              Review connections and ownership in {labels.tenant} using your own Microsoft account.
            </p>
          </div>
          <div className="inventory-access-note">
            <ShieldCheck className="icon-size-300 shrink-0" aria-hidden="true" />
            <div className="space-y-200">
              <h2 className="text-400 font-semibold">
                {!setup.ready ? 'Admin sign-in setup required' : 'Connect a tenant admin account'}
              </h2>
              <p>Requests use your signed-in account; Fabric enforces tenant-admin permissions. Connecting an account alone does not grant admin access.</p>
              <p className="font-medium">Read-only permission: <span className="font-monospace">Tenant.Read.All</span></p>
            </div>
          </div>
          {!setup.ready ? (
            <div className="inventory-notice" data-error="true" role="alert">
              <div className="space-y-200">
                <p className="font-semibold">Admin sign-in is not configured.</p>
                <p>{setup.error.message}</p>
                <p>No admin sign-in or inventory requests will run until valid configuration is supplied.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-400">
              {embedded && (
                <p className="text-muted-foreground">
                  Your inventory stays inside Fabric. A temporary sign-in window will ask you to continue
                  to Microsoft; it closes when authentication finishes.
                </p>
              )}
              {error && <p className="inventory-notice" data-error="true" role="alert">{error.message}</p>}
              {busy && (
                <p className="flex items-center gap-200 text-muted-foreground" role="status">
                  <LoaderCircle className="icon-size-200 motion-safe:animate-spin" aria-hidden="true" />
                  {busy === 'connecting' ? 'Waiting for Microsoft admin sign-in…' : 'Clearing this app’s admin session…'}
                </p>
              )}
              <div className="flex flex-wrap gap-300">
                <button className="inventory-button inventory-button-primary" onClick={connect} disabled={busy !== null}>
                  Connect admin account
                </button>
                {error?.action === 'disconnect' && (
                  <button className="inventory-button" onClick={disconnect} disabled={busy !== null}>Retry disconnect</button>
                )}
              </div>
            </div>
          )}
          <p className="border-t pt-500 text-200 text-muted-foreground">
            This app keeps its admin session only in memory. Reloading may require another explicit sign-in.
            Disconnect clears this app’s session and displayed data; it does not sign you out of Microsoft in other apps.
          </p>
        </section>
      </main>
    </div>
  );
}

function InventoryApp({ session, onDisconnect, onReconnect }: {
  session: AdminSession;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const { snapshot, loading, cancelled, refresh, cancel } = useInventory();
  const labels = getInventoryLabels();
  const [filters, setFilters] = useState<InventoryFilters>(emptyFilters);
  const [sort, setSort] = useState<InventorySort>({ column: 'displayName', direction: 'asc' });
  const [page, setPage] = useState(1);
  const counts = useMemo(() => summarizeInventory(snapshot), [snapshot]);
  const rows = useMemo(
    () => selectConnections(snapshot.connections, filters, sort),
    [snapshot.connections, filters, sort]
  );
  const connectorTypes = useMemo(
    () => [...new Set([
      ...snapshot.connections.map((row) => row.connectorType).filter(Boolean),
      ...(filters.connectorType ? [filters.connectorType] : []),
    ])].sort((a, b) => a.localeCompare(b)),
    [snapshot.connections, filters.connectorType]
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const firstRow = (currentPage - 1) * PAGE_SIZE;
  const visibleRows = rows.slice(firstRow, firstRow + PAGE_SIZE);
  const hasFilters = Boolean(filters.search || filters.connectorType || filters.ownerStatus !== 'all');
  const complete = snapshot.phase === 'done' && snapshot.inventoryComplete;

  function updateFilters(update: Partial<InventoryFilters>) {
    setFilters((previous) => ({ ...previous, ...update }));
    setPage(1);
  }

  function updateSort(column: SortColumn) {
    setSort((previous) => ({
      column,
      direction: previous.column === column && previous.direction === 'asc' ? 'desc' : 'asc',
    }));
    setPage(1);
  }

  function refreshInventory() {
    setPage(1);
    refresh();
  }

  let emptyTitle = 'No matching connections';
  let emptyDescription = 'Try a different search or clear the filters.';
  if (!hasFilters && counts.total === 0) {
    if (loading) {
      emptyTitle = 'Loading connections…';
      emptyDescription = 'Retrieving tenant connections from Microsoft Fabric. No sample data is shown.';
    } else if (complete) {
      emptyTitle = 'No connections returned';
      emptyDescription = 'Microsoft Fabric returned an empty connection inventory for this request.';
    } else {
      emptyTitle = 'No connection data available';
      emptyDescription = 'The inventory has not completed. Retry the request to load connections.';
    }
  }

  return (
    <div className="inventory-app min-h-full font-base text-300 leading-300">
      <a href="#inventory-content" className="inventory-skip-link">Skip to connection inventory</a>
      <InventoryHeader>
        <button className="inventory-button" onClick={onDisconnect}>
          <LogOut className="icon-size-200" aria-hidden="true" /> Disconnect admin account
        </button>
      </InventoryHeader>

      <main id="inventory-content" className="inventory-container space-y-600 py-800" tabIndex={-1}>
        <section className="flex flex-wrap items-start justify-between gap-500" aria-labelledby="page-title">
          <div className="space-y-300">
            <p className="inventory-eyebrow">CONNECTION GOVERNANCE</p>
            <h1 id="page-title" className="text-hero-800 leading-hero-800 font-semibold">Connection inventory</h1>
            <p className="max-w-prose text-400 leading-400 text-muted-foreground">
              Review tenant connections, ownership, and endpoints in one place. Nothing here changes your Fabric configuration.
            </p>
          </div>
          <div className="space-y-200">
            <div className="flex flex-wrap items-center gap-200">
              {loading && (
                <button className="inventory-button" onClick={cancel}>
                  <X className="icon-size-200" aria-hidden="true" /> Cancel
                </button>
              )}
              <button className="inventory-button inventory-button-primary" onClick={refreshInventory}>
                <RefreshCw className="icon-size-200" aria-hidden="true" />
                {loading ? 'Restart refresh' : 'Refresh inventory'}
              </button>
            </div>
            <p className="text-200 text-muted-foreground">
              {complete && snapshot.updatedAt ? (
                <>Last refreshed <time dateTime={snapshot.updatedAt}>{formatTimestamp(snapshot.updatedAt)}</time></>
              ) : 'No completed refresh in this session'}
            </p>
          </div>
        </section>

        <section className="inventory-access-note" aria-label="Access and deployment context">
          <ShieldCheck className="icon-size-300 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-100">
            <p>Requests use your signed-in account; Fabric enforces tenant-admin permissions. Read-only <span className="font-monospace">Tenant.Read.All</span>.</p>
            <p className="break-words">Signed-in account: <strong>{session.username || 'Account name not provided'}</strong></p>
            <p className="text-200 text-muted-foreground">
              Hosted in <span className="font-medium">{labels.workspace}</span>. Inventory scope: {labels.tenant}.
              {' '}If access expires or another account is needed, choose Connect again. Sign-in does not grant tenant-admin rights.
            </p>
            <button className="inventory-button mt-200" onClick={onReconnect}>Connect again</button>
          </div>
        </section>

        <section className="inventory-metrics" aria-label="Unfiltered inventory summary">
          <div className="inventory-metric inventory-metric-primary">
            <p className="text-muted-foreground">{snapshot.inventoryComplete ? 'Connections' : 'Connections loaded'}</p>
            <p className="inventory-metric-number">{counts.total.toLocaleString()}</p>
            <p className="text-200 text-muted-foreground">{snapshot.inventoryComplete ? 'All connection pages received' : 'Partial until all pages load'}</p>
          </div>
          <div className="inventory-metric">
            <p className="text-muted-foreground">Connector types</p>
            <p className="inventory-metric-number">{counts.connectorTypes.toLocaleString()}</p>
            <p className="text-200 text-muted-foreground">Across loaded connections</p>
          </div>
          <div className="inventory-metric">
            <p className="text-muted-foreground">Owner lookups resolved</p>
            <p className="inventory-metric-number">{counts.resolved.toLocaleString()}<span className="inventory-metric-denominator"> / {counts.total.toLocaleString()}</span></p>
            <p className="text-200 text-muted-foreground">{counts.pending.toLocaleString()} not yet resolved</p>
          </div>
          <div className="inventory-metric">
            <p className="text-muted-foreground">Owner lookup errors</p>
            <p className="inventory-metric-number">{counts.failed.toLocaleString()}</p>
            <p className="text-200 text-muted-foreground">{counts.failed > 0 ? 'Owner data needs another lookup' : 'No failed lookups reported'}</p>
          </div>
        </section>

        <InventoryStatus snapshot={snapshot} loading={loading} cancelled={cancelled} onRetry={refreshInventory} />

        <section className="inventory-panel" aria-labelledby="connections-title">
          <div className="space-y-500 border-b p-500 sm:p-600">
            <div className="flex flex-wrap items-center justify-between gap-300">
              <h2 id="connections-title" className="text-500 leading-500 font-semibold">Connections</h2>
              <span className="text-200 text-muted-foreground">{rows.length.toLocaleString()} matching · {counts.total.toLocaleString()} loaded</span>
            </div>
            <div className="inventory-filters">
              <label className="inventory-field">
                <span>Search inventory</span>
                <span className="inventory-search">
                  <Search className="icon-size-200" aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Name, ID, owner, type, or endpoint"
                    value={filters.search}
                    onChange={(event) => updateFilters({ search: event.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </span>
              </label>
              <label className="inventory-field">
                <span>Connector type</span>
                <select value={filters.connectorType} onChange={(event) => updateFilters({ connectorType: event.target.value })}>
                  <option value="">All connector types</option>
                  {connectorTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="inventory-field">
                <span>Owner resolution</span>
                <select
                  value={filters.ownerStatus}
                  onChange={(event) => updateFilters({ ownerStatus: event.target.value as InventoryFilters['ownerStatus'] })}
                >
                  <option value="all">All owner statuses</option>
                  <option value="loaded">Resolved</option>
                  <option value="pending">Not yet resolved</option>
                  <option value="error">Lookup failed</option>
                  <option value="none">Resolved · no owners returned</option>
                </select>
              </label>
              <button
                className="inventory-button"
                disabled={!hasFilters}
                onClick={() => { setFilters(emptyFilters); setPage(1); }}
              >
                Clear filters
              </button>
            </div>
          </div>
          <ConnectionTable
            rows={visibleRows}
            sort={sort}
            onSort={updateSort}
            loading={loading}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          />
          <div className="flex flex-wrap items-center justify-between gap-300 border-t px-500 py-400">
            <p className="text-200 text-muted-foreground" aria-live="polite">
              {rows.length === 0 ? '0 results' : `${(firstRow + 1).toLocaleString()}–${Math.min(firstRow + PAGE_SIZE, rows.length).toLocaleString()} of ${rows.length.toLocaleString()} results`}
              <span aria-hidden="true"> · </span>{PAGE_SIZE} per page
            </p>
            <nav className="flex items-center gap-300" aria-label="Connection pages">
              <button className="inventory-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">
                <ArrowLeft className="icon-size-200" aria-hidden="true" />
                <span className="hidden sm:inline">Previous</span>
              </button>
              <span className="text-200">Page {currentPage.toLocaleString()} of {totalPages.toLocaleString()}</span>
              <button className="inventory-button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} aria-label="Next page">
                <span className="hidden sm:inline">Next</span>
                <ArrowRight className="icon-size-200" aria-hidden="true" />
              </button>
            </nav>
          </div>
        </section>

        <footer className="flex items-start gap-200 pb-400 text-200 text-muted-foreground">
          <Info className="icon-size-200 shrink-0" aria-hidden="true" />
          <p>
            Fabric may return only an owner’s principal ID and type, not a display name.
            IDs are shown exactly as returned; names are not inferred. Pending owner assignments are labeled separately.
            Endpoints are displayed as text, not opened or tested. Summary counts include all loaded connections, regardless of filters.
            {' '}Disconnect clears only this app’s in-memory admin session, not your Microsoft sign-in in other apps.
          </p>
        </footer>
      </main>
    </div>
  );
}

export default App;
