/**
 * Node.js file-based local database implementation.
 * This provides persistence for Node.js environments where IndexedDB is not available.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  DataCorruptionError,
  LocalDatabaseError,
  QuotaExceededError,
  StorageUnavailableError,
} from "../core/errors.js";
import type {
  LocalDatabase,
  LocalSaveOptions,
  LocalState,
} from "../core/interfaces.js";
import type { RemoteSnapshot } from "../core/types.js";

/**
 * Configuration options for Node.js file-based LocalDatabase implementation.
 */
export interface NodeFileLocalDatabaseOptions {
  /** Directory path for storing data files (default: ~/.static-cms-db) */
  dataDir?: string;

  /** Filename for snapshot data (default: "snapshot.json") */
  snapshotFile?: string;

  /** Filename for metadata (default: "metadata.json") */
  metadataFile?: string;

  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Node.js file-based implementation of LocalDatabase for server-side persistence.
 *
 * Uses JSON files to persist snapshots and sync state on the filesystem.
 * Suitable for Node.js environments where IndexedDB is not available.
 */
export class NodeFileLocalDatabase implements LocalDatabase {
  private readonly options: Required<
    Omit<NodeFileLocalDatabaseOptions, "debug">
  > & { debug: boolean };
  private isInitialized = false;

  constructor(options: NodeFileLocalDatabaseOptions = {}) {
    this.options = {
      dataDir: options.dataDir || join(homedir(), ".static-cms-db"),
      snapshotFile: options.snapshotFile || "snapshot.json",
      metadataFile: options.metadataFile || "metadata.json",
      debug: options.debug || false,
    };
  }

  async init(): Promise<void> {
    try {
      if (this.isInitialized) {
        return; // Already initialized
      }

      // Ensure data directory exists
      await fs.mkdir(this.options.dataDir, { recursive: true });

      this.isInitialized = true;
      this.debugLog("Node file local database initialized", {
        dataDir: this.options.dataDir,
      });
    } catch (error) {
      throw this.wrapError(error, "Failed to initialize Node file database");
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
      throw this.wrapError(error, "Failed to load from file storage");
    }
  }

  async save(
    snapshot: RemoteSnapshot,
    options: LocalSaveOptions,
  ): Promise<void> {
    await this.ensureInitialized();

    try {
      // Save snapshot
      await this.saveSnapshot(snapshot);

      // Save metadata
      await this.saveMetadata(options);

      this.debugLog("Saved snapshot to file", {
        commitId: snapshot.commitId,
        synced: options.synced,
        schemasCount: snapshot.schemas.length,
        recordsCount: snapshot.records.length,
      });
    } catch (error) {
      throw this.wrapError(error, "Failed to save to file storage");
    }
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();

    try {
      // Remove snapshot file
      try {
        await fs.unlink(this.getSnapshotPath());
      } catch (error) {
        // Ignore if file doesn't exist
        if ((error as { code: string }).code !== "ENOENT") {
          throw error;
        }
      }

      // Remove metadata file
      try {
        await fs.unlink(this.getMetadataPath());
      } catch (error) {
        // Ignore if file doesn't exist
        if ((error as { code: string }).code !== "ENOENT") {
          throw error;
        }
      }

      this.debugLog("Cleared all data from file storage");
    } catch (error) {
      throw this.wrapError(error, "Failed to clear file storage");
    }
  }

  async destroy(): Promise<void> {
    try {
      this.isInitialized = false;
      this.debugLog("Node file local database destroyed");
    } catch (error) {
      throw this.wrapError(error, "Failed to destroy file storage connection");
    }
  }

  private async loadSnapshot(): Promise<RemoteSnapshot | null> {
    try {
      const snapshotPath = this.getSnapshotPath();
      const data = await fs.readFile(snapshotPath, "utf-8");
      const snapshot = JSON.parse(data) as RemoteSnapshot;

      // Validate the loaded data
      if (this.isValidSnapshot(snapshot)) {
        return snapshot;
      } else {
        this.debugLog("Invalid snapshot found in file", { snapshot });
        return null; // Treat as corrupted data
      }
    } catch (error) {
      if ((error as { code: string }).code === "ENOENT") {
        // File doesn't exist - this is normal for first run
        return null;
      }

      if (error instanceof SyntaxError) {
        throw new DataCorruptionError(
          `Invalid JSON format in snapshot file: ${error.message}`,
        );
      }

      throw error;
    }
  }

  private async loadHasUnsyncedChanges(): Promise<boolean> {
    try {
      const metadataPath = this.getMetadataPath();
      const data = await fs.readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(data) as { hasUnsyncedChanges: boolean };
      return metadata.hasUnsyncedChanges || false;
    } catch (error) {
      // If we can't load metadata, assume no unsynced changes
      if ((error as { code: string }).code === "ENOENT") {
        return false;
      }
      return false;
    }
  }

  private async saveSnapshot(snapshot: RemoteSnapshot): Promise<void> {
    const snapshotPath = this.getSnapshotPath();
    const data = JSON.stringify(snapshot, null, 2);
    await fs.writeFile(snapshotPath, data, "utf-8");
  }

  private async saveMetadata(options: LocalSaveOptions): Promise<void> {
    const metadataPath = this.getMetadataPath();
    const metadata = {
      hasUnsyncedChanges: !options.synced,
      lastSavedAt: options.meta?.savedAt || new Date().toISOString(),
      reason: options.meta?.reason || "unknown",
    };
    const data = JSON.stringify(metadata, null, 2);
    await fs.writeFile(metadataPath, data, "utf-8");
  }

  private getSnapshotPath(): string {
    return join(this.options.dataDir, this.options.snapshotFile);
  }

  private getMetadataPath(): string {
    return join(this.options.dataDir, this.options.metadataFile);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }
  }

  private isValidSnapshot(data: unknown): data is RemoteSnapshot {
    if (!data || typeof data !== "object") return false;
    const snapshot = data as Record<string, unknown>;

    return (
      typeof snapshot.commitId === "string" &&
      Array.isArray(snapshot.schemas) &&
      Array.isArray(snapshot.records) &&
      snapshot.schemas.every(
        (schema: Record<string, unknown>) =>
          typeof schema.name === "string" && Array.isArray(schema.fields),
      ) &&
      snapshot.records.every(
        (record: Record<string, unknown>) =>
          typeof record.id === "string" &&
          typeof record.schema === "string" &&
          typeof record.data === "object",
      )
    );
  }

  private wrapError(error: unknown, context: string): LocalDatabaseError {
    if (error instanceof LocalDatabaseError) {
      return error;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (
        message.includes("enospc") ||
        message.includes("quota") ||
        message.includes("disk full")
      ) {
        return new QuotaExceededError(`${context}: ${error.message}`, error);
      }

      if (
        message.includes("eacces") ||
        message.includes("eperm") ||
        message.includes("permission denied")
      ) {
        return new StorageUnavailableError(
          `${context}: ${error.message}`,
          error,
        );
      }

      if (
        message.includes("data") ||
        message.includes("parse") ||
        message.includes("json") ||
        message.includes("invalid")
      ) {
        return new DataCorruptionError(`${context}: ${error.message}`, error);
      }
    }

    return new LocalDatabaseError(
      `${context}: ${error instanceof Error ? error.message : String(error)}`,
      "UNKNOWN_ERROR",
      error instanceof Error ? error : undefined,
    );
  }

  private debugLog(message: string, data?: unknown): void {
    if (this.options.debug) {
      console.log(`[NodeFileLocalDatabase] ${message}`, data);
    }
  }
}
