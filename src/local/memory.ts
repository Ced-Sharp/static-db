import { LocalDatabaseError } from "../core/errors.js";
import type {
  LocalDatabase,
  LocalSaveOptions,
  LocalState,
} from "../core/interfaces.js";
import type { RemoteSnapshot } from "../core/types.js";

/**
 * In-memory implementation of LocalDatabase for testing and development.
 *
 * This implementation stores data in memory and is lost when the instance
 * is destroyed. It's useful for:
 * - Unit testing
 * - Development environments
 * - Server-side rendering scenarios
 * - Situations where persistence is not needed
 */
export class MemoryLocalDatabase implements LocalDatabase {
  private snapshot: RemoteSnapshot | null = null;
  private hasUnsyncedChanges = false;
  private metadata: {
    lastSavedAt?: string;
    reason?: string;
  } = {};
  private saveLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      /** Enable debug logging (default: false) */
      debug?: boolean;
    } = {},
  ) {}

  async init(): Promise<void> {
    this.debugLog("Memory local database initialized");
    // No initialization needed for in-memory storage
  }

  async load(): Promise<LocalState> {
    this.debugLog("Loading local state", {
      hasSnapshot: !!this.snapshot,
      hasUnsyncedChanges: this.hasUnsyncedChanges,
    });

    return {
      snapshot: structuredClone(this.snapshot),
      hasUnsyncedChanges: this.hasUnsyncedChanges,
    };
  }

  async save(
    snapshot: RemoteSnapshot,
    options: LocalSaveOptions,
  ): Promise<void> {
    // Wait for last save to complete
    await this.saveLock;

    // Create new save lock
    let resolveSave: null | ((v: void | PromiseLike<void>) => void) = null;
    this.saveLock = new Promise((r) => (resolveSave = r));

    try {
      this.snapshot = structuredClone(snapshot);
      this.hasUnsyncedChanges = !options.synced;

      if (options.meta) {
        this.metadata = {
          lastSavedAt: options.meta.savedAt,
          reason: options.meta.reason,
        };
      } else {
        this.metadata.lastSavedAt = new Date().toISOString();
      }

      this.debugLog("Saved snapshot to memory", {
        commitId: snapshot.commitId,
        synced: options.synced,
        schemasCount: snapshot.schemas?.length ?? 0,
        recordsCount: snapshot.records?.length ?? 0,
      });

      // @ts-expect-error - TypeScript doesn't like the promise trick above
      resolveSave?.();
    } catch (error) {
      // @ts-expect-error - TypeScript doesn't like the promise trick above
      resolveSave?.();

      throw new LocalDatabaseError(
        `Failed to save to memory: ${error instanceof Error ? error.message : String(error)}`,
        "SAVE_ERROR",
        error instanceof Error ? error : undefined,
      );
    }
  }

  async clear(): Promise<void> {
    this.snapshot = null;
    this.hasUnsyncedChanges = false;
    this.metadata = {};

    this.debugLog("Cleared all data from memory");
  }

  async destroy(): Promise<void> {
    this.clear();
    this.debugLog("Memory local database destroyed");
  }

  /**
   * Get internal state for testing purposes.
   * This method should only be used in tests.
   */
  _getInternalState(): {
    snapshot: RemoteSnapshot | null;
    hasUnsyncedChanges: boolean;
    metadata: InstanceType<typeof MemoryLocalDatabase>["metadata"];
  } {
    return {
      snapshot: this.snapshot,
      hasUnsyncedChanges: this.hasUnsyncedChanges,
      metadata: { ...this.metadata },
    };
  }

  /**
   * Set internal state for testing purposes.
   * This method should only be used in tests.
   */
  _setInternalState(state: {
    snapshot?: RemoteSnapshot | null;
    hasUnsyncedChanges?: boolean;
    metadata?: InstanceType<typeof MemoryLocalDatabase>["metadata"];
  }): void {
    if (state.snapshot !== undefined) {
      this.snapshot = state.snapshot ? { ...state.snapshot } : null;
    }
    if (state.hasUnsyncedChanges !== undefined) {
      this.hasUnsyncedChanges = state.hasUnsyncedChanges;
    }
    if (state.metadata !== undefined) {
      this.metadata = { ...state.metadata };
    }
  }

  private debugLog(message: string, data?: unknown): void {
    if (this.options.debug) {
      console.log(`[MemoryLocalDatabase] ${message}`, data);
    }
  }
}
