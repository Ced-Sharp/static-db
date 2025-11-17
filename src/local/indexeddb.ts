import { LocalDatabase, LocalState, LocalSaveOptions } from "../core/interfaces.js";
import { RemoteSnapshot } from "../core/types.js";
import { QuotaExceededError, StorageUnavailableError, DataCorruptionError, LocalDatabaseError } from "../core/errors.js";

/**
 * Configuration options for IndexedDB LocalDatabase implementation.
 */
export interface IndexedDBLocalDatabaseOptions {
  /** Database name (default: "static-cms-db") */
  dbName?: string;

  /** Database version for migrations (default: 1) */
  version?: number;

  /** Store name for snapshots (default: "snapshots") */
  storeName?: string;

  /** Store name for metadata (default: "metadata") */
  metaStoreName?: string;

  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * IndexedDB implementation of LocalDatabase for client-side persistence.
 *
 * Uses a single object store to persist snapshots and sync state.
 * Supports schema migrations through version upgrades.
 */
export class IndexedDBLocalDatabase implements LocalDatabase {
  private readonly options: Required<Omit<IndexedDBLocalDatabaseOptions, "debug">> & { debug: boolean };
  private db: IDBDatabase | null = null;

  constructor(options: IndexedDBLocalDatabaseOptions = {}) {
    this.options = {
      dbName: options.dbName || "static-cms-db",
      version: options.version || 1,
      storeName: options.storeName || "snapshots",
      metaStoreName: options.metaStoreName || "metadata",
      debug: options.debug || false,
    };
  }

  async init(): Promise<void> {
    try {
      if (this.db) {
        return; // Already initialized
      }

      this.db = await this.openDatabase();
      this.debugLog("IndexedDB initialized", { dbName: this.options.dbName });
    } catch (error) {
      throw this.wrapError(error, "Failed to initialize IndexedDB");
    }
  }

  async load(): Promise<LocalState> {
    await this.ensureInitialized();

    try {
      const snapshot = await this.loadSnapshot();
      const hasUnsyncedChanges = await this.loadHasUnsyncedChanges();

      this.debugLog("Loaded local state", {
        hasSnapshot: !!snapshot,
        hasUnsyncedChanges,
      });

      return {
        snapshot,
        hasUnsyncedChanges,
      };
    } catch (error) {
      throw this.wrapError(error, "Failed to load from IndexedDB");
    }
  }

  async save(snapshot: RemoteSnapshot, options: LocalSaveOptions): Promise<void> {
    await this.ensureInitialized();

    try {
      const transaction = this.db!.transaction([this.options.storeName, this.options.metaStoreName], "readwrite");

      // Save snapshot
      await this.saveSnapshotInTransaction(transaction, snapshot);

      // Save metadata
      await this.saveMetadataInTransaction(transaction, options);

      await this.waitForTransaction(transaction);

      this.debugLog("Saved snapshot to IndexedDB", {
        commitId: snapshot.commitId,
        synced: options.synced,
        schemasCount: snapshot.schemas.length,
        recordsCount: snapshot.records.length,
      });
    } catch (error) {
      throw this.wrapError(error, "Failed to save to IndexedDB");
    }
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();

    try {
      const transaction = this.db!.transaction([this.options.storeName, this.options.metaStoreName], "readwrite");

      // Clear snapshot store
      const snapshotStore = transaction.objectStore(this.options.storeName);
      const clearRequest = snapshotStore.clear();

      // Clear metadata store
      const metaStore = transaction.objectStore(this.options.metaStoreName);
      const clearMetaRequest = metaStore.clear();

      await Promise.all([
        this.waitForRequest(clearRequest),
        this.waitForRequest(clearMetaRequest),
      ]);

      await this.waitForTransaction(transaction);

      this.debugLog("Cleared all data from IndexedDB");
    } catch (error) {
      throw this.wrapError(error, "Failed to clear IndexedDB");
    }
  }

  async destroy(): Promise<void> {
    try {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      this.debugLog("IndexedDB connection closed");
    } catch (error) {
      throw this.wrapError(error, "Failed to destroy IndexedDB connection");
    }
  }

  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.options.dbName, this.options.version);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message || "Unknown error"}`));
      };

      request.onblocked = () => {
        this.debugLog("Database open blocked - waiting for other connections to close");
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createObjectStores(db);
      };

      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }

  private createObjectStores(db: IDBDatabase): void {
    // Create snapshot store (will only ever have one record)
    if (!db.objectStoreNames.contains(this.options.storeName)) {
      const snapshotStore = db.createObjectStore(this.options.storeName, { keyPath: "id" });
      snapshotStore.createIndex("commitId", "commitId", { unique: true });
      snapshotStore.createIndex("updatedAt", "updatedAt", { unique: false });
    }

    // Create metadata store
    if (!db.objectStoreNames.contains(this.options.metaStoreName)) {
      const metaStore = db.createObjectStore(this.options.metaStoreName, { keyPath: "key" });
    }
  }

  private async loadSnapshot(): Promise<RemoteSnapshot | null> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.options.storeName], "readonly");
      const store = transaction.objectStore(this.options.storeName);
      const request = store.get("current");

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          try {
            // Validate the loaded data
            if (this.isValidSnapshot(result.snapshot)) {
              resolve(result.snapshot);
            } else {
              this.debugLog("Invalid snapshot found in IndexedDB", { result });
              resolve(null); // Treat as corrupted data
            }
          } catch (error) {
            reject(new DataCorruptionError(`Invalid snapshot format: ${error instanceof Error ? error.message : String(error)}`));
          }
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        reject(new Error(`Failed to load snapshot: ${request.error?.message || "Unknown error"}`));
      };
    });
  }

  private async loadHasUnsyncedChanges(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.options.metaStoreName], "readonly");
      const store = transaction.objectStore(this.options.metaStoreName);
      const request = store.get("syncState");

      request.onsuccess = () => {
        const result = request.result;
        resolve(result?.hasUnsyncedChanges || false);
      };

      request.onerror = () => {
        // If we can't load metadata, assume no unsynced changes
        resolve(false);
      };
    });
  }

  private async saveSnapshotInTransaction(transaction: IDBTransaction, snapshot: RemoteSnapshot): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = transaction.objectStore(this.options.storeName);
      const record = {
        id: "current",
        snapshot,
        commitId: snapshot.commitId,
        updatedAt: new Date().toISOString(),
      };

      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save snapshot: ${request.error?.message || "Unknown error"}`));
    });
  }

  private async saveMetadataInTransaction(transaction: IDBTransaction, options: LocalSaveOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = transaction.objectStore(this.options.metaStoreName);
      const record = {
        key: "syncState",
        hasUnsyncedChanges: !options.synced,
        lastSavedAt: options.meta?.savedAt || new Date().toISOString(),
        reason: options.meta?.reason || "unknown",
      };

      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save metadata: ${request.error?.message || "Unknown error"}`));
    });
  }

  private async waitForTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error(`Transaction failed: ${transaction.error?.message || "Unknown error"}`));
      transaction.onabort = () => reject(new Error(`Transaction aborted: ${transaction.error?.message || "Unknown error"}`));
    });
  }

  private async waitForRequest(request: IDBRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Request failed: ${request.error?.message || "Unknown error"}`));
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      await this.init();
    }
  }

  private isValidSnapshot(data: unknown): data is RemoteSnapshot {
    if (!data || typeof data !== "object") return false;
    const snapshot = data as any;

    return (
      typeof snapshot.commitId === "string" &&
      Array.isArray(snapshot.schemas) &&
      Array.isArray(snapshot.records) &&
      snapshot.schemas.every((schema: any) =>
        typeof schema.name === "string" &&
        Array.isArray(schema.fields)
      ) &&
      snapshot.records.every((record: any) =>
        typeof record.id === "string" &&
        typeof record.schema === "string" &&
        typeof record.data === "object"
      )
    );
  }

  private wrapError(error: unknown, context: string): LocalDatabaseError {
    if (error instanceof LocalDatabaseError) {
      return error;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes("quota") || message.includes("storage")) {
        return new QuotaExceededError(`${context}: ${error.message}`, error);
      }

      if (message.includes("invalid state") || message.includes("blocked")) {
        return new StorageUnavailableError(`${context}: ${error.message}`, error);
      }

      if (message.includes("data") || message.includes("parse") || message.includes("invalid")) {
        return new DataCorruptionError(`${context}: ${error.message}`, error);
      }
    }

    return new LocalDatabaseError(`${context}: ${error instanceof Error ? error.message : String(error)}`, "UNKNOWN_ERROR", error instanceof Error ? error : undefined);
  }

  private debugLog(message: string, data?: unknown): void {
    if (this.options.debug) {
      console.log(`[IndexedDBLocalDatabase] ${message}`, data);
    }
  }
}