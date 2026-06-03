/*
 * Connector ports — the "sockets" any data source plugs into. This is the R2D2
 * half of Alter/Me/A/I: the astromech that jacks into any port and carries data home.
 * (The C3PO half — interpreting/translating it into meaning — is the Mind.)
 *
 * A Connector's only job: authenticate (with explicit permission), pull from one
 * source, and normalize what it finds into AlterMeAIEvents that flow through the
 * SAME cortex → permission gate → neurotype as every other stream. Adding a
 * source is implementing this interface — never a refactor of the vault/Mind.
 *
 * IMPORTANT — runtime reality: a browser extension is sandboxed; some connectors
 * (drive scan, health-portal OAuth + bulk download, persistent pulls) can only
 * run in a LOCAL COMPANION app/native host, which feeds events to Alter/Me/A/I through
 * the same permission gate. `runtime` declares where a connector must live so the
 * UI can show "needs the Alter/Me/A/I companion" vs. "runs in the extension".
 */

import type { NewEvent, Sensitivity, Stream } from '../vault/types';

/** Where a connector can physically run. */
export type ConnectorRuntime =
  | 'extension' // runs inside the browser extension (DOM/content-script reach)
  | 'companion'; // needs the local companion app (filesystem, OAuth, bulk pull)

/** How a connector authenticates to its source. All grants are explicit. */
export type ConnectorAuth =
  | 'none' // public/local, no auth (e.g. a granted local folder once chosen)
  | 'oauth' // SMART-on-FHIR / portal OAuth (e.g. MyChart/Epic)
  | 'apikey' // user-supplied key (e.g. Steam Web API)
  | 'file'; // user picks an exported file / folder (File System Access)

/** A permission grant for a connector — explicit, scoped, revocable. */
export interface ConnectorGrant {
  /** True only after the user has explicitly enabled this connector. */
  enabled: boolean;
  /** Default-deny: a connector never pulls without an active grant. */
  grantedAt?: number;
  /** Optional auto-expiry (epoch-ms); absent = until revoked. */
  expiresAt?: number;
  /** Opaque per-connector config the user supplied (folder handle id, etc.). */
  config?: Record<string, unknown>;
}

/** Static description of a source, for the UI and the registry. */
export interface ConnectorInfo {
  /** Stable id, e.g. 'steam', 'mychart', 'local-media', 'spotify'. */
  id: string;
  name: string;
  /** Which life-stream its events belong to. */
  stream: Stream;
  runtime: ConnectorRuntime;
  auth: ConnectorAuth;
  /** Default sensitivity floor for this source (health is high). */
  sensitivity: Sensitivity;
  /** The data standard it speaks, if any (FHIR, ID3, xAPI, …) — for docs/interop. */
  standard?: string;
  /** One-line description of what it pulls. */
  blurb: string;
}

/**
 * The socket contract. A source implements this; the host (extension or
 * companion) calls `pull()` only when `grant.enabled`. `pull` returns
 * normalized events — it NEVER writes to the vault directly; the host appends
 * them through the permission gate so the cortex stays the single chokepoint.
 */
export interface Connector {
  readonly info: ConnectorInfo;
  /** Is this connector usable in the current runtime? (e.g. companion present.) */
  available(): boolean | Promise<boolean>;
  /** Pull new events since `since` (epoch-ms). Must respect the grant. */
  pull(grant: ConnectorGrant, since?: number): Promise<NewEvent[]>;
}
