import { describe, expect, it, beforeEach, vi } from "vitest";

import { DefaultSyncService } from "../../src/sync/service";
import { RemoteDatabase, LocalDatabase } from "../../src/core/interfaces";
import { RemoteSnapshot } from "../../src/core/types";
import { OutOfDateError, SyncError, NetworkError } from "../../src/core/errors";
import { MemoryLocalDatabase } from "../../src/local/memory";

// Mock implementations for testing
class MockRemoteDatabase implements RemoteDatabase {
  private currentCommitId = "initial123";
  private snapshots: Map<string, RemoteSnapshot> = new Map();

  constructor() {
    // Initialize with empty snapshot
    const initialSnapshot: RemoteSnapshot = {
      commitId: this.currentCommitId,
      schemas: [],
      records: [],
    };
    this.snapshots.set(this.currentCommitId, initialSnapshot);
  }

  async init(): Promise<void> {
    // No initialization needed
  }

  async fetchSnapshot(): Promise<RemoteSnapshot> {
    const snapshot = this.snapshots.get(this.currentCommitId);
    if (!snapshot) {
      throw new Error("Snapshot not found");
    }
    return { ...snapshot };
  }

  async pushSnapshot(
    baseCommitId: string,
    newSnapshot: Omit<RemoteSnapshot, "commitId">,
  ): Promise<{ newCommitId: string }> {
    if (baseCommitId !== this.currentCommitId) {
      throw new OutOfDateError("Remote advanced", baseCommitId, this.currentCommitId);
    }

    this.currentCommitId = `commit${Date.now()}`;
    const snapshot: RemoteSnapshot = {
      ...newSnapshot,
      commitId: this.currentCommitId,
    };
    this.snapshots.set(this.currentCommitId, snapshot);

    return { newCommitId: this.currentCommitId };
  }

  async ping(): Promise<void> {
    // Simple health check
  }

  async destroy(): Promise<void> {
    this.snapshots.clear();
  }

  // Test helper methods
  advanceRemote(): void {
    this.currentCommitId = `advanced${Date.now()}`;
    const snapshot: RemoteSnapshot = {
      commitId: this.currentCommitId,
      schemas: [{ name: "test", fields: [] }],
      records: [],
    };
    this.snapshots.set(this.currentCommitId, snapshot);
  }

  setPushError(shouldError: boolean, errorType: "OutOfDate" | "Network" = "Network"): void {
    if (!shouldError) {
      this.pushSnapshot = this.originalPushSnapshot.bind(this);
      return;
    }

    if (errorType === "OutOfDate") {
      this.pushSnapshot = async () => {
        throw new OutOfDateError("Simulated out of date");
      };
    } else {
      this.pushSnapshot = async () => {
        throw new NetworkError("Simulated network error");
      };
    }
  }

  private originalPushSnapshot(
    baseCommitId: string,
    newSnapshot: Omit<RemoteSnapshot, "commitId">,
  ): Promise<{ newCommitId: string }> {
    return this.pushSnapshot(baseCommitId, newSnapshot);
  }
}

describe("DefaultSyncService", () => {
  let remote: MockRemoteDatabase;
  let local: MemoryLocalDatabase;
  let sync: DefaultSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    remote = new MockRemoteDatabase();
    local = new MemoryLocalDatabase();
    sync = new DefaultSyncService({
      remote,
      local,
      debug: false,
      maxRetries: 2,
      retryDelay: 10, // Short delay for tests
    });
  });

  describe("Initial Load", () => {
    it("loads initial state when no local data exists", async () => {
      const snapshot = await sync.loadInitial();

      expect(snapshot.commitId).toBe("initial123");
      expect(snapshot.schemas).toEqual([]);
      expect(snapshot.records).toEqual([]);

      // Should be saved locally
      const localState = await local.load();
      expect(localState.snapshot).toEqual(snapshot);
      expect(localState.hasUnsyncedChanges).toBe(false);
    });

    it("uses local data when in sync with remote", async () => {
      // First, establish local state
      const initialSnapshot = await sync.loadInitial();

      // Reset sync service to simulate restart
      const newSync = new DefaultSyncService({ remote, local });

      const snapshot = await newSync.loadInitial();

      expect(snapshot).toEqual(initialSnapshot);
    });

    it("adopts remote state when remote has advanced", async () => {
      // First load establishes local state
      await sync.loadInitial();

      // Advance remote
      remote.advanceRemote();

      // New sync service should adopt remote state
      const newSync = new DefaultSyncService({ remote, local });
      const snapshot = await newSync.loadInitial();

      expect(snapshot.commitId).not.toBe("initial123");
      expect(snapshot.schemas).toHaveLength(1);

      // Local should be updated
      const localState = await local.load();
      expect(localState.snapshot?.commitId).toBe(snapshot.commitId);
      expect(localState.hasUnsyncedChanges).toBe(false);
    });

    it("uses local state when remote fetch fails", async () => {
      // First load establishes local state
      await sync.loadInitial();

      // Simulate remote failure
      const originalFetch = remote.fetchSnapshot;
      remote.fetchSnapshot = async () => {
        throw new NetworkError("Remote unavailable");
      };

      const newSync = new DefaultSyncService({ remote, local });
      const snapshot = await newSync.loadInitial();

      // Should fall back to local state
      expect(snapshot.commitId).toBe("initial123");

      // Restore original method
      remote.fetchSnapshot = originalFetch;
    });

    it("handles initialization errors", async () => {
      const failingRemote = {
        init: async () => {
          throw new Error("Remote init failed");
        },
        fetchSnapshot: async () => ({ commitId: "test", schemas: [], records: [] } as RemoteSnapshot),
      } as any;

      const failingSync = new DefaultSyncService({ remote: failingRemote, local });

      await expect(failingSync.loadInitial()).rejects.toThrow(SyncError);
    });
  });

  describe("Synchronization", () => {
    beforeEach(async () => {
      // Establish initial state
      await sync.loadInitial();
    });

    it("syncs successfully when remote matches local", async () => {
      const localSnapshot: RemoteSnapshot = {
        commitId: "initial123",
        schemas: [
          {
            name: "product",
            fields: [{ name: "title", type: "string", required: true }],
          },
        ],
        records: [
          {
            id: "prod-1",
            schema: "product",
            data: { title: "New Product" },
            createdAt: "2023-01-01T00:00:00.000Z",
            updatedAt: "2023-01-01T00:00:00.000Z",
          },
        ],
      };

      const result = await sync.sync(localSnapshot);

      expect(result.status).toBe("pushed");
      expect(result.snapshot.commitId).not.toBe("initial123");
      expect(result.snapshot.schemas).toHaveLength(1);
      expect(result.snapshot.records).toHaveLength(1);
      expect(result.meta?.changesPushed).toBe(2); // 1 schema + 1 record
    });

    it("resets to remote when remote has advanced", async () => {
      // Advance remote while we have local changes
      remote.advanceRemote();

      const localSnapshot: RemoteSnapshot = {
        commitId: "initial123", // Still has old commit ID
        schemas: [{ name: "local", fields: [] }],
        records: [],
      };

      const result = await sync.sync(localSnapshot);

      expect(result.status).toBe("resetToRemote");
      expect(result.snapshot.commitId).not.toBe("initial123");
      expect(result.snapshot.schemas).toHaveLength(1);
      expect(result.snapshot.schemas[0].name).toBe("test");
      expect(result.meta?.reason).toContain("Remote advanced");
    });

    it("resets to remote when push fails with OutOfDateError", async () => {
      remote.setPushError(true, "OutOfDate");

      const localSnapshot: RemoteSnapshot = {
        commitId: "initial123",
        schemas: [{ name: "local", fields: [] }],
        records: [],
      };

      const result = await sync.sync(localSnapshot);

      expect(result.status).toBe("resetToRemote");
      expect(result.snapshot.commitId).toBe("initial123");
      expect(result.meta?.reason).toContain("Push failed");
    });

    it("resets to remote when push fails with NetworkError", async () => {
      remote.setPushError(true, "Network");

      const localSnapshot: RemoteSnapshot = {
        commitId: "initial123",
        schemas: [{ name: "local", fields: [] }],
        records: [],
      };

      const result = await sync.sync(localSnapshot);

      expect(result.status).toBe("resetToRemote");
      expect(result.snapshot.commitId).toBe("initial123");
      expect(result.meta?.reason).toContain("Push failed");
    });

    it("handles complex sync scenario", async () => {
      // 1. Initial state established
      let snapshot = await sync.loadInitial();

      // 2. Make local changes
      const localChanges = {
        ...snapshot,
        schemas: [
          ...snapshot.schemas,
          {
            name: "category",
            fields: [{ name: "name", type: "string", required: true }],
          },
        ],
        records: [
          ...snapshot.records,
          {
            id: "cat-1",
            schema: "category",
            data: { name: "Test Category" },
            createdAt: "2023-01-01T00:00:00.000Z",
            updatedAt: "2023-01-01T00:00:00.000Z",
          },
        ],
      };

      // 3. Sync successfully
      let result = await sync.sync(localChanges);
      expect(result.status).toBe("pushed");
      snapshot = result.snapshot;

      // 4. Remote advances (simulating another client)
      remote.advanceRemote();

      // 5. Try to sync with stale local data
      const staleChanges = {
        ...snapshot,
        records: [
          ...snapshot.records,
          {
            id: "local-change",
            schema: "category",
            data: { name: "Local Change" },
            createdAt: "2023-01-01T00:00:00.000Z",
            updatedAt: "2023-01-01T00:00:00.000Z",
          },
        ],
      };

      // 6. Should reset to remote, losing local changes
      result = await sync.sync(staleChanges);
      expect(result.status).toBe("resetToRemote");
    });

    it("includes metadata in sync results", async () => {
      const localSnapshot: RemoteSnapshot = {
        commitId: "initial123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
        meta: { custom: "value" },
      };

      const result = await sync.sync(localSnapshot);

      expect(result.meta).toBeDefined();
      expect(result.meta?.previousCommitId).toBe("initial123");
      expect(result.meta?.changesPushed).toBe(1);
      expect(result.meta?.duration).toBeGreaterThan(0);
    });
  });

  describe("Can Sync Check", () => {
    it("returns true when sync is possible", async () => {
      await sync.loadInitial();

      const canSync = await sync.canSync({
        commitId: "initial123",
        schemas: [],
        records: [],
      });

      expect(canSync).toBe(true);
    });

    it("returns false when remote ping fails", async () => {
      const failingRemote = {
        init: async () => {},
        ping: async () => {
          throw new NetworkError("Remote unreachable");
        },
        fetchSnapshot: async () => ({ commitId: "test", schemas: [], records: [] } as RemoteSnapshot),
      } as any;

      const failingSync = new DefaultSyncService({ remote: failingRemote, local });

      const canSync = await failingSync.canSync({
        commitId: "initial123",
        schemas: [],
        records: [],
      });

      expect(canSync).toBe(false);
    });

    it("returns false when local loading fails", async () => {
      const failingLocal = {
        init: async () => {
          throw new Error("Local storage error");
        },
        load: async () => ({ snapshot: null, hasUnsyncedChanges: false }),
        save: async () => {},
      } as any;

      const failingSync = new DefaultSyncService({ remote, local: failingLocal });

      const canSync = await failingSync.canSync({
        commitId: "initial123",
        schemas: [],
        records: [],
      });

      expect(canSync).toBe(false);
    });
  });

  describe("Retry Logic", () => {
    it("retries on retryable errors", async () => {
      let attemptCount = 0;
      remote.setPushError(true, "Network");

      // Mock to succeed after 2 attempts
      const originalPush = remote.pushSnapshot.bind(remote);
      remote.pushSnapshot = async (...args) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new NetworkError("Temporary failure");
        }
        return originalPush(...args);
      };

      const localSnapshot: RemoteSnapshot = {
        commitId: "initial123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      const result = await sync.sync(localSnapshot);

      expect(result.status).toBe("pushed");
      expect(attemptCount).toBe(3);
    });

    it("does not retry OutOfDateError", async () => {
      let attemptCount = 0;
      remote.setPushError(true, "OutOfDate");

      const originalPush = remote.pushSnapshot.bind(remote);
      remote.pushSnapshot = async (...args) => {
        attemptCount++;
        throw new OutOfDateError("Permanent out of date");
      };

      const localSnapshot: RemoteSnapshot = {
        commitId: "initial123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      const result = await sync.sync(localSnapshot);

      expect(result.status).toBe("resetToRemote");
      expect(attemptCount).toBe(1); // Should not retry
    });
  });

  describe("Configuration", () => {
    it("uses custom retry configuration", async () => {
      const customSync = new DefaultSyncService({
        remote,
        local,
        debug: true,
        maxRetries: 1,
        retryDelay: 5,
      });

      expect(customSync).toBeInstanceOf(DefaultSyncService);
    });

    it("handles debug mode", async () => {
      const debugSync = new DefaultSyncService({
        remote,
        local,
        debug: true,
      });

      // Should not throw and should log debug information
      await expect(debugSync.loadInitial()).resolves.toBeDefined();
    });
  });

  describe("Destroy", () => {
    it("destroys both remote and local", async () => {
      await sync.loadInitial();

      await sync.destroy();

      // Should not throw and both should be destroyed
      await expect(sync.loadInitial()).rejects.toThrow();
    });

    it("handles destroy errors", async () => {
      const failingRemote = {
        init: async () => {},
        fetchSnapshot: async () => ({ commitId: "test", schemas: [], records: [] } as RemoteSnapshot),
        destroy: async () => {
          throw new Error("Remote destroy failed");
        },
      } as any;

      const failingSync = new DefaultSyncService({ remote: failingRemote, local });

      await expect(failingSync.destroy()).rejects.toThrow(SyncError);
    });
  });

  describe("Error Handling", () => {
    it("wraps errors in SyncError", async () => {
      const failingRemote = {
        init: async () => {},
        fetchSnapshot: async () => {
          throw new Error("Generic error");
        },
      } as any;

      const failingSync = new DefaultSyncService({ remote: failingRemote, local });

      await expect(failingSync.loadInitial()).rejects.toThrow(SyncError);
    });

    it("preserves error phase information", async () => {
      const failingRemote = {
        init: async () => {},
        fetchSnapshot: async () => {
          throw new Error("Fetch error");
        },
      } as any;

      const failingSync = new DefaultSyncService({ remote: failingRemote, local });

      try {
        await failingSync.sync({ commitId: "test", schemas: [], records: [] });
      } catch (error) {
        expect(error).toBeInstanceOf(SyncError);
        if (error instanceof SyncError) {
          expect(error.syncPhase).toBe("sync");
        }
      }
    });
  });
});