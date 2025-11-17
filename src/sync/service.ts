import { isErrorOfType, OutOfDateError, SyncError } from "../core/errors.js";
import type {
  LocalDatabase,
  RemoteDatabase,
  SyncResult,
  SyncService,
} from "../core/interfaces.js";
import type { RemoteSnapshot } from "../core/types.js";

/**
 * Options for the DefaultSyncService implementation.
 */
export interface SyncServiceOptions {
  /** Remote database implementation */
  remote: RemoteDatabase;

  /** Local database implementation */
  local: LocalDatabase;

  /** Enable debug logging (default: false) */
  debug?: boolean;

  /** Maximum retry attempts for failed syncs (default: 3) */
  maxRetries?: number;

  /** Delay between retry attempts in milliseconds (default: 1000) */
  retryDelay?: number;
}

/**
 * Default implementation of SyncService that orchestrates sync operations
 * between a remote and local database using a "remote wins" conflict policy.
 *
 * Sync algorithm:
 * 1. If no local state exists, fetch from remote and save locally
 * 2. If local and remote commit IDs match, attempt to push local changes
 * 3. If remote has advanced, discard local changes and adopt remote state
 * 4. If push fails for any reason, fetch latest remote and reset local state
 *
 * This implements the policy specified in the requirements: "remote is source
 * of truth, discard local on conflicts/failures".
 */
export class DefaultSyncService implements SyncService {
  private readonly options: Required<Omit<SyncServiceOptions, "debug">> & {
    debug: boolean;
  };

  constructor(options: SyncServiceOptions) {
    this.options = {
      remote: options.remote,
      local: options.local,
      debug: options.debug || false,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
    };
  }

  async loadInitial(): Promise<RemoteSnapshot> {
    const startTime = Date.now();

    try {
      this.debugLog("Starting initial load");

      // Initialize both databases
      await Promise.all([
        this.options.local.init(),
        this.options.remote.init?.(),
      ]);

      // Load local state
      const localState = await this.options.local.load();

      if (!localState.snapshot) {
        // First time setup - fetch from remote
        this.debugLog("No local state found, fetching from remote");
        const remoteSnapshot = await this.options.remote.fetchSnapshot();

        await this.options.local.save(remoteSnapshot, {
          synced: true,
          meta: {
            savedAt: new Date().toISOString(),
            reason: "fetch",
          },
        });

        this.debugLog("Initial load completed (first time)", {
          commitId: remoteSnapshot.commitId,
          duration: Date.now() - startTime,
        });

        return remoteSnapshot;
      }

      // Local state exists, but let's check if remote is newer
      try {
        const remoteSnapshot = await this.options.remote.fetchSnapshot();

        if (remoteSnapshot.commitId !== localState.snapshot.commitId) {
          // Remote has advanced, adopt remote state
          this.debugLog(
            "Remote advanced during initial load, adopting remote state",
            {
              localCommitId: localState.snapshot.commitId,
              remoteCommitId: remoteSnapshot.commitId,
            },
          );

          await this.options.local.save(remoteSnapshot, {
            synced: true,
            meta: {
              savedAt: new Date().toISOString(),
              reason: "reset",
            },
          });

          this.debugLog("Initial load completed (remote adopted)", {
            commitId: remoteSnapshot.commitId,
            duration: Date.now() - startTime,
          });

          return remoteSnapshot;
        }

        // Local and remote are in sync
        this.debugLog("Initial load completed (already in sync)", {
          commitId: localState.snapshot.commitId,
          duration: Date.now() - startTime,
        });

        return localState.snapshot;
      } catch (fetchError) {
        // Failed to fetch from remote, use local state
        this.debugLog(
          "Failed to fetch from remote during initial load, using local state",
          {
            error:
              fetchError instanceof Error
                ? fetchError.message
                : String(fetchError),
          },
        );

        if (localState.hasUnsyncedChanges) {
          this.debugLog("Warning: Using local state with unsynced changes");
        }

        return localState.snapshot;
      }
    } catch (error) {
      throw new SyncError(
        `Initial load failed: ${error instanceof Error ? error.message : String(error)}`,
        "INITIAL_LOAD_FAILED",
        error instanceof Error ? error : undefined,
        "initial_load",
      );
    }
  }

  async sync(localSnapshot: RemoteSnapshot): Promise<SyncResult> {
    const startTime = Date.now();

    try {
      this.debugLog("Starting sync", {
        localCommitId: localSnapshot.commitId,
        schemasCount: localSnapshot.schemas.length,
        recordsCount: localSnapshot.records.length,
      });

      // Fetch latest remote state
      const remoteSnapshot = await this.options.remote.fetchSnapshot();

      // Check if remote has advanced
      if (remoteSnapshot.commitId !== localSnapshot.commitId) {
        // Remote advanced - reset local state to remote
        this.debugLog("Remote advanced, resetting local state", {
          localCommitId: localSnapshot.commitId,
          remoteCommitId: remoteSnapshot.commitId,
        });

        await this.options.local.save(remoteSnapshot, {
          synced: true,
          meta: {
            savedAt: new Date().toISOString(),
            reason: "reset",
          },
        });

        return {
          status: "resetToRemote",
          snapshot: remoteSnapshot,
          meta: {
            previousCommitId: localSnapshot.commitId,
            reason: "Remote advanced since last sync",
            duration: Date.now() - startTime,
          },
        };
      }

      // Remote hasn't advanced, try to push local changes
      try {
        const pushResult = await this.withRetry(
          () =>
            this.options.remote.pushSnapshot(localSnapshot.commitId, {
              schemas: localSnapshot.schemas,
              records: localSnapshot.records,
              meta: localSnapshot.meta,
            }),
          "push",
        );

        // Push succeeded - construct new snapshot
        const newSnapshot: RemoteSnapshot = {
          ...localSnapshot,
          commitId: pushResult.newCommitId,
          meta: {
            ...localSnapshot.meta,
            fetchedAt: new Date().toISOString(),
          },
        };

        await this.options.local.save(newSnapshot, {
          synced: true,
          meta: {
            savedAt: new Date().toISOString(),
            reason: "sync",
          },
        });

        this.debugLog("Sync completed successfully", {
          newCommitId: pushResult.newCommitId,
          duration: Date.now() - startTime,
        });

        return {
          status: "pushed",
          snapshot: newSnapshot,
          meta: {
            previousCommitId: localSnapshot.commitId,
            changesPushed:
              localSnapshot.schemas.length + localSnapshot.records.length,
            reason: "Local changes pushed successfully",
            duration: Date.now() - startTime,
          },
        };
      } catch (pushError) {
        // Push failed - fetch latest remote and reset
        this.debugLog("Push failed, fetching latest remote", {
          error:
            pushError instanceof Error ? pushError.message : String(pushError),
        });

        const latestRemote = await this.options.remote.fetchSnapshot();

        await this.options.local.save(latestRemote, {
          synced: true,
          meta: {
            savedAt: new Date().toISOString(),
            reason: "reset",
          },
        });

        return {
          status: "resetToRemote",
          snapshot: latestRemote,
          meta: {
            previousCommitId: localSnapshot.commitId,
            reason: `Push failed: ${pushError instanceof Error ? pushError.message : String(pushError)}`,
            duration: Date.now() - startTime,
          },
        };
      }
    } catch (error) {
      this.debugLog("Sync failed", {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      throw new SyncError(
        `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
        "SYNC_FAILED",
        error instanceof Error ? error : undefined,
        "sync",
      );
    }
  }

  async canSync(localSnapshot: RemoteSnapshot): Promise<boolean> {
    try {
      this.debugLog("Checking if sync is possible", {
        localCommitId: localSnapshot.commitId,
      });

      // Check if we can reach remote
      await this.options.remote.ping?.();

      // TODO: do we need this?
      // Check if we have local storage
      // const localState = await this.options.local.load();

      return true;
    } catch (error) {
      this.debugLog("Sync not possible", {
        error: error instanceof Error ? error.message : String(error),
      });

      return false;
    }
  }

  async destroy(): Promise<void> {
    try {
      await Promise.all([
        this.options.local.destroy?.(),
        this.options.remote.destroy?.(),
      ]);

      this.debugLog("Sync service destroyed");
    } catch (error) {
      throw new SyncError(
        `Failed to destroy sync service: ${error instanceof Error ? error.message : String(error)}`,
        "DESTROY_FAILED",
        error instanceof Error ? error : undefined,
        "destroy",
      );
    }
  }

  /**
   * Execute a function with retry logic.
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    attempt = 1,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // Don't retry OutOfDateError - it's a signal that we need to reset
      if (isErrorOfType(error, OutOfDateError)) {
        throw error;
      }

      // Don't retry if we've exceeded max attempts
      if (attempt >= this.options.maxRetries) {
        throw error;
      }

      this.debugLog(`${operationName} failed, retrying`, {
        attempt,
        maxRetries: this.options.maxRetries,
        error: error instanceof Error ? error.message : String(error),
      });

      // Wait before retrying
      await this.delay(this.options.retryDelay * attempt);

      return this.withRetry(operation, operationName, attempt + 1);
    }
  }

  /**
   * Simple delay utility.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Debug logging utility.
   */
  private debugLog(message: string, data?: unknown): void {
    if (this.options.debug) {
      console.log(`[DefaultSyncService] ${message}`, data);
    }
  }
}
