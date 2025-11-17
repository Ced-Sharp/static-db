# Project Spec: Git-Backed Local-First CMS Data Layer (Exploration)

## 1. Overview

This project is an exploration of using **Git as a “database”** for a small,
single-user CMS, with a strong focus on:

- **Zero infrastructure cost** (GitHub/GitLab free tiers, static hosting).
- **No backend server** for the main UX (frontend SPA only; tiny auth helper
  may exist later, but is out-of-scope here).
- **Developer-oriented setup** (tokens, repo configs handled by dev, not end
  user).
- **Pluggable remote storage** so that GitHub/GitLab can be swapped later for
  Firebase/Supabase/etc. without rewriting core logic.

This document describes:

- The **scope** of this exploration.
- The **data model** (schemas, records, snapshots).
- The **required abstractions**:
  - `RemoteDatabase` (GitHub/GitLab/Firebase adapter).
  - `LocalDatabase` (IndexedDB adapter).
  - Optional `SyncService` orchestrator.
- The **sync policy**: **remote is source of truth**; local unsynced changes
  may be discarded on conflicts or failures.

The goal of this first version: a robust, minimal data layer that can be used
by a CMS dashboard SPA to manage content stored in a Git repo.

---

## 2. Scope and Non-Goals

### 2.1. In Scope (for this exploration)

- A **TypeScript data layer** with clear interfaces and a simple reference
  implementation path:
  - Interfaces:
    - Domain types (`SchemaDef`, `EntityRecord`, `RemoteSnapshot`).
    - `RemoteDatabase` abstraction.
    - `LocalDatabase` abstraction.
    - Optional `SyncService` orchestration interface.
  - Local persistence assumed to be **IndexedDB**, but the implementation
    detail is behind `LocalDatabase`.
  - Remote persistence assumed to be **GitHub** (via Git APIs) for the first
    implementation, but code must be designed so other backends can be added.

- A **sync model** that:
  - Treats **remote as canonical**.
  - Allows local editing and caching.
  - Batches edits into a single “push snapshot” operation.
  - If sync fails or remote advances unexpectedly, **local unsynced changes
    are discarded** and replaced with the latest remote snapshot.

- A **file-based conceptual remote layout**:
  - Schemas and records are JSON-based files in a repo.
  - Example layout (for Git-based backends):

    ```text
    /schemas/
      product.json
      category.json
    /content/
      product/prod-123.json
      product/prod-456.json
      category/cat-1.json
    ```

  The RemoteDatabase interface won’t assume this layout, but the first GitHub
  implementation will likely use something like it.

### 2.2. Out of Scope (for this first version)

- Static site generation / public storefront.
- Authentication UX (OAuth flow, PAT storage, etc.).
- Conflict resolution / merging:
  - There is **no attempt to merge** local and remote changes.
  - If divergence is detected or push fails, local is reset to remote.
- Multi-user/editor concurrency:
  - Assume effectively one writer.
  - Multi-device is allowed but last sync wins; no explicit conflict handling.

---

## 3. Design Goals

1. **Backend Pluggability**
   - The application code must not depend directly on GitHub, GitLab, or
     Firebase APIs.
   - All remote operations go through `RemoteDatabase`.
   - All local persistence goes through `LocalDatabase`.

2. **Simplicity in Sync**
   - Use a **snapshot-based model** instead of per-operation logs.
   - One “commit ID” / “version” string to identify the remote state.
   - No partial merges; either:
     - Push snapshot succeeds → local and remote are aligned.
     - Push snapshot fails or remote changed → reset local to remote.

3. **Developer-Oriented Setup**
   - Authentication tokens, repo configuration, etc. are provided to the
     `RemoteDatabase` implementation by the developer.
   - No requirement for non-technical UX for these parts.

4. **Local-First UX Support**
   - Full data is cached locally for fast access and possibly offline editing.
   - On next sync, local snapshot is either pushed or discarded.

---

## 4. Domain Types

These types describe the CMS schema and record model, plus the remote snapshot.

```ts
export type SchemaName = string;
export type RecordId = string;

/**
 * Field definition inside a schema.
 * Implementation is allowed to extend this shape.
 */
export interface FieldDef {
  /** Field key, unique within the schema. */
  name: string;

  /** Primitive type or higher-level CMS field type. */
  type: string; // e.g., "string" | "number" | "boolean" | "relation" | ...

  /** Whether the field is required. */
  required?: boolean;

  /** Default value for the field if not provided. */
  defaultValue?: unknown;

  /** Optional human-readable label. */
  label?: string;

  /** Optional arbitrary constraints (backend-agnostic). */
  constraints?: Record<string, unknown>;
}

/**
 * Schema/collection definition.
 */
export interface SchemaDef {
  /** Name of the schema/collection (e.g., "product"). */
  name: SchemaName;

  /** Optional label to display in UI. */
  label?: string;

  /** Field definitions for this schema. */
  fields: FieldDef[];

  /** Optional description for docs/UI. */
  description?: string;

  /**
   * Optional version identifier for migrations.
   * Implementations can use this to evolve schemas over time.
   */
  version?: number;
}

/**
 * Represents one "row" / "record".
 */
export interface EntityRecord {
  /** Unique identifier of this record. */
  id: RecordId;

  /** Name of the schema this record belongs to. */
  schema: SchemaName;

  /**
   * Actual data payload. Keys should match FieldDef names inside the schema.
   */
  data: Record<string, unknown>;

  /** ISO timestamp when the record was created. */
  createdAt: string;

  /** ISO timestamp when the record was last updated. */
  updatedAt: string;

  /**
   * Optional additional metadata:
   * - createdBy, updatedBy, version, etc.
   */
  meta?: Record<string, unknown>;
}

/**
 * A complete view of the remote data at a point in time.
 *
 * - For Git-based backends, `commitId` will be a commit SHA.
 * - For Firestore, it might be a logical version or timestamp.
 */
export interface RemoteSnapshot {
  /** Remote "version" identifier (commit SHA, timestamp, etc.). */
  commitId: string;

  /** All schemas known to the system. */
  schemas: SchemaDef[];

  /** All records across all schemas. */
  records: EntityRecord[];
}
```

---

## 5. RemoteDatabase Interface

`RemoteDatabase` represents a **canonical remote backend**: GitHub, GitLab,
Firestore, etc. It exposes an abstraction around “fetch current snapshot” and
“push new snapshot based on a known commitId”.

The **application must only talk to this interface**, never to GitHub/Firebase
directly.

```ts
/**
 * Initialization options for a RemoteDatabase instance.
 * Concrete implementations can extend this via intersection types.
 */
export interface RemoteDatabaseInitOptions {
  /**
   * A logical identifier for the remote project/database.
   *
   * Examples:
   * - For GitHub: "owner/repo"
   * - For GitLab: "namespace/project"
   * - For Firebase: "projectId"
   */
  endpointId?: string;

  /** Human-readable name for logging/debugging. */
  label?: string;
}

/**
 * Canonical remote data store abstraction.
 *
 * Responsibilities:
 *  - Provide a full snapshot of current data (`fetchSnapshot`).
 *  - Accept a new snapshot, based on a known "version" (`pushSnapshot`).
 *
 * This is intentionally high-level and snapshot-based to keep sync logic
 * simple and backend-agnostic.
 */
export interface RemoteDatabase {
  /**
   * Optional initialization for the remote backend.
   * - May open connections, validate auth, etc.
   * - May be a no-op, but should be safe to call multiple times.
   */
  init?(options?: RemoteDatabaseInitOptions): Promise<void>;

  /**
   * Fetch the canonical snapshot from the remote backend.
   *
   * Implementations:
   *  - For GitHub/GitLab:
   *      - Read schemas and content files from a repo.
   *      - `commitId` should reflect the HEAD commit SHA of the relevant branch.
   *  - For Firestore:
   *      - Read all documents in the relevant collections.
   *      - `commitId` could be a logical version or last update timestamp.
   */
  fetchSnapshot(): Promise<RemoteSnapshot>;

  /**
   * Push a new snapshot to the remote backend, assuming the caller's view
   * of remote was at `baseCommitId`.
   *
   * - `baseCommitId` should correspond to a recent `RemoteSnapshot.commitId`.
   * - `newSnapshot` represents the desired state for schemas and records.
   *
   * Implementations should:
   *  - Validate that the remote is still at `baseCommitId` (if applicable).
   *  - If remote diverged (i.e., another commit/version exists), they MAY:
   *      - throw a specific "OutOfDate" error (recommended),
   *      - or reject with a generic error.
   *
   * The caller (sync layer) will interpret ANY failure as "remote wins" for
   * now and reset local to remote.
   */
  pushSnapshot(
    baseCommitId: string,
    newSnapshot: Omit<RemoteSnapshot, "commitId">,
  ): Promise<{ newCommitId: string }>;

  /**
   * Optional lightweight health check.
   *
   * Implementations may:
   *  - test API availability,
   *  - verify that the token has necessary permissions,
   *  - etc.
   */
  ping?(): Promise<void>;
}
```

### Notes for Implementors

- For Git-based implementations:
  - `fetchSnapshot()` likely:
    - Reads HEAD commit SHA.
    - Reads all schema + record files from a known directory layout.
  - `pushSnapshot()` likely:
    - Checks HEAD SHA against `baseCommitId`.
    - If equal, writes updated JSON files and creates a new commit.
    - Returns `{ newCommitId: newSha }`.

- For Firebase/Firestore:
  - `commitId` might be:
    - A synthetic “snapshotVersion,”
    - Or a last-write timestamp fetched from some `_meta` document.

- The interface is deliberately minimal; advanced operations
  (partial updates, query APIs) can be added later if necessary.

---

## 6. LocalDatabase Interface

`LocalDatabase` abstracts **client-side persistence**, typically backed by
IndexedDB. It is responsible for:

- Loading the last known snapshot and sync state from the browser.
- Saving updated snapshots and a `hasUnsyncedChanges` flag.
- Optionally clearing data for a “reset” operation.

The caller does not know or care about IndexedDB; it only sees this interface.

```ts
/**
 * Represents the last saved local state.
 *
 * - `snapshot`:
 *    - If non-null: the last snapshot loaded or edited locally.
 *    - If null: this is the first run on this device/browser.
 * - `hasUnsyncedChanges`:
 *    - true: local snapshot contains edits not yet successfully pushed.
 *    - false: local snapshot matches the last known remote state.
 */
export interface LocalState {
  snapshot: RemoteSnapshot | null;
  hasUnsyncedChanges: boolean;
}

/**
 * Options when saving to the LocalDatabase.
 */
export interface LocalSaveOptions {
  /**
   * Whether the snapshot being saved is fully in sync with remote.
   *
   * - `synced: true`:
   *    - Typically after:
   *      - fetching from remote, or
   *      - successful push to remote.
   *    - Local `hasUnsyncedChanges` should be set to false.
   *
   * - `synced: false`:
   *    - After local edits only.
   *    - Local `hasUnsyncedChanges` should be set to true.
   */
  synced: boolean;
}

/**
 * Client-side persistence for CMS state.
 * Typical implementation: IndexedDB.
 */
export interface LocalDatabase {
  /**
   * Initialize underlying storage (e.g., open IndexedDB database, perform
   * migrations, etc.).
   *
   * This should be called at application startup before `load`.
   * It must be safe to call multiple times.
   */
  init(): Promise<void>;

  /**
   * Load the last known state from local storage.
   *
   * - If no data exists yet, returns:
   *    - `snapshot: null`
   *    - `hasUnsyncedChanges: false`
   *
   * - If data exists, returns:
   *    - `snapshot`: last persisted snapshot (remote or locally edited)
   *    - `hasUnsyncedChanges`: flag saved at last `save` call.
   */
  load(): Promise<LocalState>;

  /**
   * Persist a snapshot and sync metadata locally.
   *
   * Usage patterns:
   *  - After fetching from remote:
   *      `save(remoteSnapshot, { synced: true })`
   *  - After local edits (before pushing):
   *      `save(localSnapshot, { synced: false })`
   *  - After successful push:
   *      `save(newRemoteSnapshot, { synced: true })`
   */
  save(snapshot: RemoteSnapshot, options: LocalSaveOptions): Promise<void>;

  /**
   * Optional: clear all local state.
   * Useful for "reset app" or "log out" flows.
   */
  clear?(): Promise<void>;
}
```

### Notes for Implementors

- For IndexedDB implementations:
  - A simple structure can be:
    - One object store with a single key, e.g. `"state"`:
      - key: `"singleton"`
      - value: `{ snapshot, hasUnsyncedChanges }`
  - Or separated object stores for `schemas`, `records`, and `meta`, if desired.

- The shape of `RemoteSnapshot` is already designed for full snapshot
  serialization/de-serialization.

- Performance considerations are minor for the expected data sizes (tiny CMS).

---

## 7. Optional SyncService Interface

To keep orchestration logic (remote vs local, conflict policy) out of UI and
adapters, we can define a small `SyncService` layer.

This is **optional** but recommended to centralize policy:

- “Remote is source of truth.”
- “If push fails or remote advanced, discard local unsynced changes.”

```ts
/**
 * Result of a sync operation.
 */
export interface SyncResult {
  /**
   * Outcome of the attempted sync.
   *
   * - "upToDate":
   *     No changes needed; local already matches remote.
   * - "pushed":
   *     Local snapshot successfully pushed; remote advanced to new commitId.
   * - "resetToRemote":
   *     Local state was discarded and replaced with latest remote state
   *     (e.g., due to conflict or push error).
   */
  status: "upToDate" | "pushed" | "resetToRemote";

  /** Snapshot that should be considered the new local state. */
  snapshot: RemoteSnapshot;
}

/**
 * High-level sync orchestrator.
 *
 * This interface is backend-agnostic and uses RemoteDatabase + LocalDatabase
 * under the hood.
 *
 * It also encodes the policy: "remote is source of truth, discard local on
 * conflicts/failures".
 */
export interface SyncService {
  /**
   * Load state for the application on startup.
   *
   * Recommended behavior:
   *  - Use LocalDatabase.load() to get last snapshot (if any).
   *  - If none, fetch from RemoteDatabase and persist it.
   *
   * The returned snapshot is what the UI should load into memory.
   */
  loadInitial(): Promise<RemoteSnapshot>;

  /**
   * Attempt to synchronize current local snapshot with remote.
   *
   * Algorithm (suggested):
   *  1. Fetch latest remote snapshot R.
   *  2. Compare R.commitId with localSnapshot.commitId.
   *     - If they differ:
   *         - Save R locally as synced.
   *         - Return { status: "resetToRemote", snapshot: R }.
   *     - If they match:
   *         - Attempt RemoteDatabase.pushSnapshot(commitId, localDataWithoutCommitId).
   *         - On success:
   *             - Construct newSnapshot with new commitId.
   *             - Save newSnapshot locally as synced.
   *             - Return { status: "pushed", snapshot: newSnapshot }.
   *         - On failure:
   *             - Fetch latest remote R2, save as synced.
   *             - Return { status: "resetToRemote", snapshot: R2 }.
   */
  sync(localSnapshot: RemoteSnapshot): Promise<SyncResult>;
}
```

---

## 8. Implementation Hints (for the Agent)

### 8.1. First Target Backend: GitHub via Content API or Git API

The **first concrete `RemoteDatabase`** to implement should be
`GitHubRemoteDatabase`, with signatures such as:

```ts
export interface GitHubRemoteDatabaseOptions
  extends RemoteDatabaseInitOptions {
  owner: string;
  repo: string;
  branch?: string;
  token: string; // developer-provided, PAT or similar
  schemasDir?: string; // default "schemas"
  contentDir?: string; // default "content"
}

export class GitHubRemoteDatabase implements RemoteDatabase {
  constructor(private options: GitHubRemoteDatabaseOptions) {}

  init?(options?: RemoteDatabaseInitOptions): Promise<void>;

  fetchSnapshot(): Promise<RemoteSnapshot>;

  pushSnapshot(
    baseCommitId: string,
    newSnapshot: Omit<RemoteSnapshot, "commitId">,
  ): Promise<{ newCommitId: string }>;

  ping?(): Promise<void>;
}
```

Implementation details (how to use Octokit, etc.) are **not** part of this spec,
but the structure above guides the adapter.

### 8.2. LocalDatabase Implementation: IndexedDB

For `LocalDatabase`, a straightforward IndexedDB-backed class is expected:

```ts
export interface IndexedDBLocalDatabaseOptions {
  dbName?: string; // default e.g. "static-cms-db"
  version?: number; // for schema migrations
}

export class IndexedDBLocalDatabase implements LocalDatabase {
  constructor(private options?: IndexedDBLocalDatabaseOptions) {}

  init(): Promise<void>;

  load(): Promise<LocalState>;

  save(snapshot: RemoteSnapshot, options: LocalSaveOptions): Promise<void>;

  clear?(): Promise<void>;
}
```

The agent implementing this can:

- Use one object store with a single record:
  - key: `"state"`,
  - value: `{ snapshot, hasUnsyncedChanges }`.
- Or more structured stores if desired.

### 8.3. SyncService Implementation

An orchestrator that wires `RemoteDatabase` + `LocalDatabase` together:

```ts
export interface SyncServiceOptions {
  remote: RemoteDatabase;
  local: LocalDatabase;
}

export class DefaultSyncService implements SyncService {
  constructor(private readonly options: SyncServiceOptions) {}

  loadInitial(): Promise<RemoteSnapshot>;

  sync(localSnapshot: RemoteSnapshot): Promise<SyncResult>;
}
```

Where `sync` implements the exact “remote wins” policy described earlier.

---

## 9. Summary

- We are building the **data layer** for a local-first, Git-backed CMS meant
  for a single user with small data.
- **Core abstractions**:
  - `RemoteDatabase`: for GitHub/GitLab/Firebase adapters (canonical data).
  - `LocalDatabase`: for IndexedDB/local caching.
  - `SyncService`: for orchestrating sync with a simple, strict policy.
- **Policy**:
  - Remote is canonical.
  - Local unsynced changes are discardable on conflicts/failures.
  - Sync is snapshot-based and simple.

The agent implementing the first version should:

1. Define these interfaces exactly as specified (or with compatible superset).
2. Implement a **GitHub-based RemoteDatabase** adapter.
3. Implement an **IndexedDB-based LocalDatabase**.
4. Implement a **DefaultSyncService** that enforces the described sync policy.

No UI, no auth UX, and no static site generation are required in this phase.
The result should be a reusable data layer library that a CMS dashboard SPA can
consume.
