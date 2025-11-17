import { beforeEach, describe, expect, it } from "vitest";
import type { RemoteSnapshot } from "../../src/core/types";
import { MemoryLocalDatabase } from "../../src/local/memory";

describe("MemoryLocalDatabase", () => {
  let db: MemoryLocalDatabase;

  beforeEach(() => {
    db = new MemoryLocalDatabase();
  });

  describe("Initialization", () => {
    it("initializes successfully", async () => {
      await expect(db.init()).resolves.toBeUndefined();
    });

    it("can be initialized multiple times", async () => {
      await db.init();
      await expect(db.init()).resolves.toBeUndefined();
    });
  });

  describe("Loading State", () => {
    it("returns empty state on first load", async () => {
      await db.init();
      const state = await db.load();

      expect(state.snapshot).toBeNull();
      expect(state.hasUnsyncedChanges).toBe(false);
    });

    it("returns saved state", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await db.save(testSnapshot, { synced: true });
      const state = await db.load();

      expect(state.snapshot).toEqual(testSnapshot);
      expect(state.hasUnsyncedChanges).toBe(false);
    });

    it("tracks unsynced changes", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await db.save(testSnapshot, { synced: false });
      const state = await db.load();

      expect(state.snapshot).toEqual(testSnapshot);
      expect(state.hasUnsyncedChanges).toBe(true);
    });
  });

  describe("Saving State", () => {
    it("saves snapshot successfully", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "def456",
        schemas: [
          {
            name: "product",
            fields: [
              { name: "title", type: "string", required: true },
              { name: "price", type: "number", required: true },
            ],
          },
        ],
        records: [
          {
            id: "prod-1",
            schema: "product",
            data: { title: "Test Product", price: 29.99 },
            createdAt: "2023-01-01T00:00:00.000Z",
            updatedAt: "2023-01-01T00:00:00.000Z",
          },
        ],
        meta: {
          fetchedAt: "2023-01-01T12:00:00.000Z",
          size: { schemasCount: 1, recordsCount: 1 },
        },
      };

      await db.save(testSnapshot, { synced: true });

      const state = await db.load();
      expect(state.snapshot).toEqual(testSnapshot);
      expect(state.hasUnsyncedChanges).toBe(false);
    });

    it("preserves metadata", async () => {
      await db.init();
      const dbWithDebug = new MemoryLocalDatabase({ debug: true });
      await dbWithDebug.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      const saveOptions = {
        synced: false,
        meta: {
          savedAt: "2023-01-01T10:00:00.000Z",
          reason: "edit" as const,
        },
      };

      await dbWithDebug.save(testSnapshot, saveOptions);

      const internalState = dbWithDebug._getInternalState();
      expect(internalState.metadata.lastSavedAt).toBe(
        "2023-01-01T10:00:00.000Z",
      );
      expect(internalState.metadata.reason).toBe("edit");
    });

    it("creates deep copies of snapshots", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await db.save(testSnapshot, { synced: true });

      // Modify original snapshot
      testSnapshot.schemas[0].name = "modified";

      // Loaded state should not be affected
      const state = await db.load();
      expect(state.snapshot?.schemas[0].name).toBe("test");
    });
  });

  describe("Clearing State", () => {
    it("clears all data", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await db.save(testSnapshot, { synced: false });
      await db.clear();

      const state = await db.load();
      expect(state.snapshot).toBeNull();
      expect(state.hasUnsyncedChanges).toBe(false);
    });
  });

  describe("Destroy", () => {
    it("destroys the database", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await db.save(testSnapshot, { synced: false });
      await db.destroy();

      const internalState = db._getInternalState();
      expect(internalState.snapshot).toBeNull();
      expect(internalState.hasUnsyncedChanges).toBe(false);
    });
  });

  describe("Testing Utilities", () => {
    it("allows getting and setting internal state", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "test123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      // Set internal state
      db._setInternalState({
        snapshot: testSnapshot,
        hasUnsyncedChanges: true,
        metadata: { reason: "test" },
      });

      // Get internal state
      const internalState = db._getInternalState();
      expect(internalState.snapshot).toEqual(testSnapshot);
      expect(internalState.hasUnsyncedChanges).toBe(true);
      expect(internalState.metadata.reason).toBe("test");

      // Verify it reflects in load()
      const state = await db.load();
      expect(state.snapshot).toEqual(testSnapshot);
      expect(state.hasUnsyncedChanges).toBe(true);
    });

    it("handles partial state updates", async () => {
      await db.init();

      // Set initial state
      const testSnapshot: RemoteSnapshot = {
        commitId: "test123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      db._setInternalState({
        snapshot: testSnapshot,
        hasUnsyncedChanges: false,
      });

      // Update only hasUnsyncedChanges
      db._setInternalState({ hasUnsyncedChanges: true });

      const internalState = db._getInternalState();
      expect(internalState.snapshot).toEqual(testSnapshot);
      expect(internalState.hasUnsyncedChanges).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("handles save errors gracefully", async () => {
      await db.init();

      // Create an invalid snapshot (this shouldn't cause issues in memory DB)
      const invalidSnapshot = {
        commitId: "abc123",
        // Missing required fields
      } as RemoteSnapshot;

      // Memory DB should accept anything since it just stores the data
      await expect(
        db.save(invalidSnapshot, { synced: true }),
      ).resolves.toBeUndefined();
    });
  });

  describe("Concurrent Operations", () => {
    it("handles concurrent save operations", async () => {
      await db.init();

      const snapshot1: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      const snapshot2: RemoteSnapshot = {
        commitId: "def456",
        schemas: [{ name: "test2", fields: [] }],
        records: [],
      };

      // Save both snapshots concurrently
      await Promise.all([
        db.save(snapshot1, { synced: true }),
        db.save(snapshot2, { synced: false }),
      ]);

      // The last save should win
      const state = await db.load();
      expect(state.snapshot?.commitId).toBe("def456");
      expect(state.hasUnsyncedChanges).toBe(true);
    });

    it("handles concurrent load operations", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await db.save(testSnapshot, { synced: true });

      // Load concurrently
      const [state1, state2, state3] = await Promise.all([
        db.load(),
        db.load(),
        db.load(),
      ]);

      expect(state1).toEqual(state2);
      expect(state2).toEqual(state3);
      expect(state1.snapshot).toEqual(testSnapshot);
    });
  });
});
