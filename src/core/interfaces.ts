import { RemoteSnapshot, SchemaDef, SchemaName, RecordId, EntityRecord } from "./types.js";

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

  /** Optional authentication token or credentials. */
  token?: string;

  /** Optional branch or version to work with. */
  branch?: string;

  /** Additional options for specific implementations. */
  [key: string]: unknown;
}

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

  /** Optional metadata to save alongside the state. */
  meta?: {
    /** When this save operation occurred. */
    savedAt?: string;
    /** Reason for saving (fetch, edit, sync, etc.). */
    reason?: "fetch" | "edit" | "sync" | "reset";
  };
}

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

  /** Additional metadata about the sync operation. */
  meta?: {
    /** Previous commit ID before sync. */
    previousCommitId?: string;
    /** Number of changes that were pushed. */
    changesPushed?: number;
    /** Reason for the sync result. */
    reason?: string;
    /** Duration of the sync operation in milliseconds. */
    duration?: number;
  };
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
   *
   * @throws {RemoteDatabaseError} On connection or authentication failures
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
   *
   * @throws {OutOfDateError} When remote has advanced since baseCommitId
   * @throws {RemoteDatabaseError} On other push failures
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
   *
   * @throws {RemoteDatabaseError} If health check fails
   */
  ping?(): Promise<void>;

  /**
   * Optional cleanup method to close connections and free resources.
   */
  destroy?(): Promise<void>;
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
   *
   * @throws {LocalDatabaseError} If initialization fails
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
   *
   * @throws {LocalDatabaseError} If loading fails
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
   *
   * @throws {LocalDatabaseError} If saving fails
   */
  save(snapshot: RemoteSnapshot, options: LocalSaveOptions): Promise<void>;

  /**
   * Optional: clear all local state.
   * Useful for "reset app" or "log out" flows.
   *
   * @throws {LocalDatabaseError} If clearing fails
   */
  clear?(): Promise<void>;

  /**
   * Optional cleanup method to close connections.
   */
  destroy?(): Promise<void>;
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
   *
   * @throws {SyncError} If loading fails
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
   *
   * @param localSnapshot Current local state to sync
   * @throws {SyncError} If sync encounters critical errors
   */
  sync(localSnapshot: RemoteSnapshot): Promise<SyncResult>;

  /**
   * Optional: check if sync would likely succeed without actually performing it.
   *
   * @param localSnapshot Current local state to check
   */
  canSync?(localSnapshot: RemoteSnapshot): Promise<boolean>;

  /**
   * Optional cleanup method.
   */
  destroy?(): Promise<void>;
}

/**
 * Query interface for finding records within schemas.
 * This is an optional extension that implementations may provide.
 */
export interface Queryable {
  /**
   * Find records matching specific criteria.
   */
  findRecords(
    schema: SchemaName,
    filters?: Record<string, unknown>,
    options?: {
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    },
  ): Promise<EntityRecord[]>;

  /**
   * Find a single record by ID.
   */
  findRecord(schema: SchemaName, id: RecordId): Promise<EntityRecord | null>;

  /**
   * Count records matching criteria.
   */
  countRecords(
    schema: SchemaName,
    filters?: Record<string, unknown>,
  ): Promise<number>;
}