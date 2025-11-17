import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DataCorruptionError,
  QuotaExceededError,
  StorageUnavailableError,
} from "../../src/core/errors";
import type { RemoteSnapshot } from "../../src/core/types";
import { NodeFileLocalDatabase } from "../../src/local/node-file";

describe("NodeFileLocalDatabase", () => {
  let db: NodeFileLocalDatabase;
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = join(tmpdir(), `static-db-test-${Date.now()}-${Math.random()}`);

    db = new NodeFileLocalDatabase({
      dataDir: tempDir,
      debug: false,
    });

    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      // Clean up temporary directory
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Initialization", () => {
    it("initializes successfully with directory creation", async () => {
      const customDir = join(tempDir, "custom-db");
      const customDb = new NodeFileLocalDatabase({
        dataDir: customDir,
      });

      await expect(customDb.init()).resolves.toBeUndefined();

      // Directory should be created
      const stats = await fs.stat(customDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("can be initialized multiple times", async () => {
      await db.init();
      await expect(db.init()).resolves.toBeUndefined();
    });

    it("handles permission errors gracefully", async () => {
      // Mock fs.mkdir to throw permission error
      const originalMkdir = fs.mkdir;
      const mockMkdir = vi.fn(() => {
        const error = new Error("Permission denied");
        (error as unknown as { code: string }).code = "EACCES";
        throw error;
      });

      fs.mkdir = mockMkdir;

      const customDb = new NodeFileLocalDatabase({
        dataDir: "/root/.static-cms-db", // Likely to cause permission error
      });

      await expect(customDb.init()).rejects.toThrow(StorageUnavailableError);

      // Restore original function
      fs.mkdir = originalMkdir;
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

    it("handles corrupted JSON data", async () => {
      await db.init();

      // Write invalid JSON to snapshot file
      const snapshotPath = join(tempDir, "snapshot.json");
      await fs.writeFile(snapshotPath, "{ invalid json", "utf-8");

      await expect(db.load()).rejects.toThrow(DataCorruptionError);
    });

    it("handles missing metadata file gracefully", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      // @ts-expect-error - Calling private method
      await db.saveSnapshot(testSnapshot);
      const state = await db.load();

      expect(state.snapshot).toEqual(testSnapshot);
      expect(state.hasUnsyncedChanges).toBe(false);
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
      };

      await db.save(testSnapshot, { synced: true });

      // Verify files exist
      const snapshotPath = join(tempDir, "snapshot.json");
      const metadataPath = join(tempDir, "metadata.json");

      await expect(fs.access(snapshotPath)).resolves.toBeUndefined();
      await expect(fs.access(metadataPath)).resolves.toBeUndefined();

      // Verify content
      const snapshotData = await fs.readFile(snapshotPath, "utf-8");
      const loadedSnapshot = JSON.parse(snapshotData) as RemoteSnapshot;

      expect(loadedSnapshot).toEqual(testSnapshot);
    });

    it("preserves metadata", async () => {
      await db.init();

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

      await db.save(testSnapshot, saveOptions);

      // Check metadata file
      const metadataPath = join(tempDir, "metadata.json");
      const metadataData = await fs.readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(metadataData);

      expect(metadata.hasUnsyncedChanges).toBe(true);
      expect(metadata.lastSavedAt).toBe("2023-01-01T10:00:00.000Z");
      expect(metadata.reason).toBe("edit");
    });

    it("creates directory structure if missing", async () => {
      const nestedDir = join(tempDir, "nested", "path");
      const nestedDb = new NodeFileLocalDatabase({
        dataDir: nestedDir,
      });

      await nestedDb.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await nestedDb.save(testSnapshot, { synced: true });

      // Directory should be created
      const stats = await fs.stat(nestedDir);
      expect(stats.isDirectory()).toBe(true);

      // Files should exist
      await expect(
        fs.access(join(nestedDir, "snapshot.json")),
      ).resolves.toBeUndefined();
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

      // Files should be gone
      await expect(fs.access(join(tempDir, "snapshot.json"))).rejects.toThrow();
      await expect(fs.access(join(tempDir, "metadata.json"))).rejects.toThrow();
    });

    it("handles clearing when no files exist", async () => {
      await db.init();
      await expect(db.clear()).resolves.toBeUndefined();
    });
  });

  describe("Destroy", () => {
    it("destroys the database instance", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await db.save(testSnapshot, { synced: false });
      await db.destroy();

      // Files should still exist after destroy (only connection is destroyed)
      await expect(
        fs.access(join(tempDir, "snapshot.json")),
      ).resolves.toBeUndefined();
    });
  });

  describe("Configuration", () => {
    it("uses custom file names", async () => {
      const customDb = new NodeFileLocalDatabase({
        dataDir: tempDir,
        snapshotFile: "custom-snapshot.json",
        metadataFile: "custom-metadata.json",
      });

      await customDb.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await customDb.save(testSnapshot, { synced: true });

      // Should use custom file names
      await expect(
        fs.access(join(tempDir, "custom-snapshot.json")),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(join(tempDir, "custom-metadata.json")),
      ).resolves.toBeUndefined();

      await expect(fs.access(join(tempDir, "snapshot.json"))).rejects.toThrow();
      await expect(fs.access(join(tempDir, "metadata.json"))).rejects.toThrow();
    });

    it("uses debug logging when enabled", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const debugDb = new NodeFileLocalDatabase({
        dataDir: tempDir,
        debug: true,
      });

      await debugDb.init();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[NodeFileLocalDatabase]"),
        expect.any(Object),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("Error Handling", () => {
    it("handles disk full errors", async () => {
      // Mock fs.writeFile to throw disk full error
      const originalWriteFile = fs.writeFile;
      const mockWriteFile = vi.fn(() => {
        throw new QuotaExceededError("No space left on device");
      });

      fs.writeFile = mockWriteFile;

      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await expect(db.save(testSnapshot, { synced: true })).rejects.toThrow(
        QuotaExceededError,
      );

      // Restore original function
      fs.writeFile = originalWriteFile;
    });

    it("handles permission errors", async () => {
      // Mock fs.writeFile to throw permission error
      const originalWriteFile = fs.writeFile;
      const mockWriteFile = vi.fn(() => {
        const error = new Error("Permission denied");
        (error as unknown as { code: string }).code = "EACCES";
        throw error;
      });

      fs.writeFile = mockWriteFile;

      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      await expect(db.save(testSnapshot, { synced: true })).rejects.toThrow(
        StorageUnavailableError,
      );

      // Restore original function
      fs.writeFile = originalWriteFile;
    });

    it("handles corrupted snapshot files", async () => {
      await db.init();

      // Write corrupted JSON
      const snapshotPath = join(tempDir, "snapshot.json");
      await fs.writeFile(snapshotPath, "{ corrupted json", "utf-8");

      await expect(db.load()).rejects.toThrow(DataCorruptionError);
    });

    it("validates loaded snapshots", async () => {
      await db.init();

      // Write invalid snapshot structure
      const snapshotPath = join(tempDir, "snapshot.json");
      const invalidSnapshot = {
        // Missing required fields
        invalid: "data",
      };
      await fs.writeFile(
        snapshotPath,
        JSON.stringify(invalidSnapshot),
        "utf-8",
      );

      const state = await db.load();
      expect(state.snapshot).toBeNull(); // Should treat as corrupted and return null
    });
  });

  describe("File Operations", () => {
    it("handles large snapshots", async () => {
      await db.init();

      // Create a large snapshot
      const largeSnapshot: RemoteSnapshot = {
        commitId: "large-snapshot",
        schemas: [
          {
            name: "product",
            fields: [
              { name: "title", type: "string", required: true },
              { name: "price", type: "number", required: true },
            ],
          },
        ],
        records: Array.from({ length: 1000 }, (_, i) => ({
          id: `product-${i}`,
          schema: "product",
          data: {
            title: `Product ${i}`,
            price: i * 10.99,
            description: "A".repeat(100), // Make it larger
          },
          createdAt: "2023-01-01T00:00:00.000Z",
          updatedAt: "2023-01-01T00:00:00.000Z",
        })),
      };

      const startTime = Date.now();
      await db.save(largeSnapshot, { synced: true });
      const saveTime = Date.now() - startTime;

      // Should complete within reasonable time (less than 1 second)
      expect(saveTime).toBeLessThan(1000);

      const loadStartTime = Date.now();
      const state = await db.load();
      const loadTime = Date.now() - loadStartTime;

      expect(state.snapshot).toEqual(largeSnapshot);
      expect(loadTime).toBeLessThan(500); // Loading should be faster than saving
    });

    it("preserves data integrity across save/load cycles", async () => {
      await db.init();

      const testSnapshot: RemoteSnapshot = {
        commitId: "integrity-test",
        schemas: [
          {
            name: "test",
            fields: [
              { name: "text", type: "string", required: true },
              { name: "number", type: "number", required: false },
              { name: "boolean", type: "boolean", required: false },
            ],
          },
        ],
        records: [
          {
            id: "test-1",
            schema: "test",
            data: {
              text: "Test string with unicode: 🚀",
              number: 42.5,
              boolean: true,
              null: null,
              array: [1, 2, 3],
              nested: { key: "value" },
            },
            createdAt: "2023-01-01T00:00:00.000Z",
            updatedAt: "2023-01-01T00:00:00.000Z",
          },
        ],
      };

      await db.save(testSnapshot, { synced: true });
      const state = await db.load();

      expect(state.snapshot).toEqual(testSnapshot);
      expect(JSON.stringify(state.snapshot)).toBe(JSON.stringify(testSnapshot));
    });
  });
});
