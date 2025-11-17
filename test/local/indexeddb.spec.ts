import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IndexedDBLocalDatabase, IndexedDBLocalDatabaseOptions } from "../../src/local/indexeddb";
import { RemoteSnapshot } from "../../src/core/types";
import { QuotaExceededError, DataCorruptionError, StorageUnavailableError } from "../../src/core/errors";

// Mock IndexedDB for testing
const mockObjectStore = {
  get: vi.fn(),
  put: vi.fn(),
  clear: vi.fn(),
  createIndex: vi.fn(),
};

const mockTransaction = {
  objectStore: vi.fn(() => mockObjectStore),
  oncomplete: null as any,
  onerror: null as any,
  onabort: null as any,
};

const mockDB = {
  close: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(),
  },
  transaction: vi.fn(() => mockTransaction),
};

const mockOpenRequest = {
  onsuccess: null as any,
  onerror: null as any,
  onblocked: null as any,
  onupgradeneeded: null as any,
  result: mockDB,
  error: null as any,
};

const mockIDB = {
  open: vi.fn(() => mockOpenRequest),
};

// Replace global indexedDB
beforeAll(() => {
  (globalThis as any).indexedDB = mockIDB;
});

afterAll(() => {
  delete (globalThis as any).indexedDB;
});

describe("IndexedDBLocalDatabase", () => {
  let db: IndexedDBLocalDatabase;
  const dbName = "test-static-cms-db";

  beforeEach(() => {
    vi.clearAllMocks();
    db = new IndexedDBLocalDatabase({
      dbName,
      version: 1,
      debug: false,
    });
  });

  describe("Initialization", () => {
    it("initializes database successfully", async () => {
      // Mock successful database open
      mockDB.objectStoreNames.contains.mockReturnValue(true);

      const initPromise = db.init();

      // Simulate successful open
      setTimeout(() => {
        if (mockOpenRequest.onsuccess) {
          mockOpenRequest.onsuccess({ target: mockOpenRequest } as any);
        }
      }, 0);

      await expect(initPromise).resolves.toBeUndefined();
      expect(mockIDB.open).toHaveBeenCalledWith(dbName, 1);
    });

    it("handles database open error", async () => {
      mockOpenRequest.error = new Error("Database access denied");

      const initPromise = db.init();

      setTimeout(() => {
        if (mockOpenRequest.onerror) {
          mockOpenRequest.onerror({ target: mockOpenRequest } as any);
        }
      }, 0);

      await expect(initPromise).rejects.toThrow("Failed to initialize IndexedDB");
    });

    it("creates object stores on upgrade", async () => {
      mockDB.objectStoreNames.contains.mockReturnValue(false);

      const mockCreateObjectStore = vi.fn(() => ({ createIndex: vi.fn() }));
      const mockTransaction = {
        objectStore: vi.fn(() => mockCreateObjectStore()),
      };
      const mockUpgradeEvent = {
        target: {
          result: {
            ...mockDB,
            transaction: mockTransaction,
            createObjectStore: mockCreateObjectStore,
          },
        },
      };

      const initPromise = db.init();

      // Simulate upgrade needed
      setTimeout(() => {
        if (mockOpenRequest.onupgradeneeded) {
          mockOpenRequest.onupgradeneeded(mockUpgradeEvent as any);
        }
        if (mockOpenRequest.onsuccess) {
          mockOpenRequest.onsuccess({ target: mockOpenRequest } as any);
        }
      }, 0);

      await expect(initPromise).resolves.toBeUndefined();
    });

    it("can be initialized multiple times", async () => {
      mockDB.objectStoreNames.contains.mockReturnValue(true);

      await db.init();
      await db.init(); // Should not call open again

      expect(mockIDB.open).toHaveBeenCalledTimes(1);
    });
  });

  describe("Loading State", () => {
    beforeEach(async () => {
      mockDB.objectStoreNames.contains.mockReturnValue(true);
      await db.init();
    });

    it("returns empty state on first load", async () => {
      mockObjectStore.get.mockImplementation(() => {
        const request = { result: null, onsuccess: null, onerror: null };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({ target: request } as any);
        }, 0);
        return request;
      });

      const statePromise = db.load();

      // Simulate successful loads
      setTimeout(() => {
        const snapshotRequest = mockObjectStore.get.mock.results[0].value;
        const metaRequest = mockObjectStore.get.mock.results[1].value;

        if (snapshotRequest.onsuccess) {
          snapshotRequest.onsuccess({ target: snapshotRequest } as any);
        }
        if (metaRequest.onsuccess) {
          metaRequest.onsuccess({ target: metaRequest } as any);
        }
      }, 0);

      const state = await statePromise;

      expect(state.snapshot).toBeNull();
      expect(state.hasUnsyncedChanges).toBe(false);
    });

    it("loads saved state", async () => {
      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      mockObjectStore.get.mockImplementation((key) => {
        const request = {
          result: key === "current"
            ? { id: "current", snapshot: testSnapshot }
            : key === "syncState"
            ? { key: "syncState", hasUnsyncedChanges: true }
            : null,
          onsuccess: null,
          onerror: null,
        };

        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({ target: request } as any);
        }, 0);

        return request;
      });

      const statePromise = db.load();

      setTimeout(() => {
        const requests = mockObjectStore.get.mock.results;
        requests.forEach((result: any) => {
          if (result.value.onsuccess) {
            result.value.onsuccess({ target: result.value } as any);
          }
        });
      }, 0);

      const state = await statePromise;

      expect(state.snapshot).toEqual(testSnapshot);
      expect(state.hasUnsyncedChanges).toBe(true);
    });

    it("handles corrupted snapshot data", async () => {
      mockObjectStore.get.mockImplementation(() => {
        const request = {
          result: { id: "current", snapshot: "invalid-data" },
          onsuccess: null,
          onerror: null,
        };

        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({ target: request } as any);
        }, 0);

        return request;
      });

      const statePromise = db.load();

      setTimeout(() => {
        const request = mockObjectStore.get.mock.results[0].value;
        if (request.onsuccess) {
          request.onsuccess({ target: request } as any);
        }
      }, 0);

      const state = await statePromise;

      expect(state.snapshot).toBeNull(); // Should treat corrupted data as null
    });
  });

  describe("Saving State", () => {
    beforeEach(async () => {
      mockDB.objectStoreNames.contains.mockReturnValue(true);
      await db.init();
    });

    it("saves snapshot successfully", async () => {
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

      mockObjectStore.put.mockImplementation(() => {
        const request = { onsuccess: null, onerror: null };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({ target: request } as any);
        }, 0);
        return request;
      });

      mockTransaction.oncomplete = vi.fn();

      const savePromise = db.save(testSnapshot, { synced: true });

      setTimeout(() => {
        // Simulate successful puts
        mockObjectStore.put.mock.results.forEach((result: any) => {
          if (result.value.onsuccess) {
            result.value.onsuccess({ target: result.value } as any);
          }
        });

        // Simulate transaction complete
        if (mockTransaction.oncomplete) {
          mockTransaction.oncomplete({} as any);
        }
      }, 0);

      await expect(savePromise).resolves.toBeUndefined();

      expect(mockObjectStore.put).toHaveBeenCalledTimes(2); // snapshot + metadata
      expect(mockDB.transaction).toHaveBeenCalledWith(["snapshots", "metadata"], "readwrite");
    });

    it("handles save errors", async () => {
      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      mockObjectStore.put.mockImplementation(() => {
        const request = {
          error: new Error("Quota exceeded"),
          onsuccess: null,
          onerror: null,
        };
        setTimeout(() => {
          if (request.onerror) request.onerror({ target: request } as any);
        }, 0);
        return request;
      });

      const savePromise = db.save(testSnapshot, { synced: true });

      setTimeout(() => {
        const request = mockObjectStore.put.mock.results[0].value;
        if (request.onerror) {
          request.onerror({ target: request } as any);
        }
      }, 0);

      await expect(savePromise).rejects.toThrow();
    });

    it("handles transaction errors", async () => {
      const testSnapshot: RemoteSnapshot = {
        commitId: "abc123",
        schemas: [{ name: "test", fields: [] }],
        records: [],
      };

      mockObjectStore.put.mockImplementation(() => {
        const request = { onsuccess: null, onerror: null };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({ target: request } as any);
        }, 0);
        return request;
      });

      mockTransaction.onerror = vi.fn(() => {
        throw new Error("Transaction failed");
      });

      const savePromise = db.save(testSnapshot, { synced: true });

      setTimeout(() => {
        // Complete the puts first
        mockObjectStore.put.mock.results.forEach((result: any) => {
          if (result.value.onsuccess) {
            result.value.onsuccess({ target: result.value } as any);
          }
        });
      }, 0);

      await expect(savePromise).rejects.toThrow("Failed to save to IndexedDB");
    });
  });

  describe("Clearing State", () => {
    beforeEach(async () => {
      mockDB.objectStoreNames.contains.mockReturnValue(true);
      await db.init();
    });

    it("clears all data", async () => {
      mockObjectStore.clear.mockImplementation(() => {
        const request = { onsuccess: null, onerror: null };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({ target: request } as any);
        }, 0);
        return request;
      });

      mockTransaction.oncomplete = vi.fn();

      const clearPromise = db.clear();

      setTimeout(() => {
        // Simulate successful clears
        mockObjectStore.clear.mock.results.forEach((result: any) => {
          if (result.value.onsuccess) {
            result.value.onsuccess({ target: result.value } as any);
          }
        });

        // Simulate transaction complete
        if (mockTransaction.oncomplete) {
          mockTransaction.oncomplete({} as any);
        }
      }, 0);

      await expect(clearPromise).resolves.toBeUndefined();

      expect(mockObjectStore.clear).toHaveBeenCalledTimes(2);
    });
  });

  describe("Destroy", () => {
    it("closes database connection", async () => {
      mockDB.objectStoreNames.contains.mockReturnValue(true);
      await db.init();

      await db.destroy();

      expect(mockDB.close).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("wraps IndexedDB errors appropriately", async () => {
      mockOpenRequest.error = new DOMException("Storage quota exceeded", "QuotaExceededError");

      const initPromise = db.init();

      setTimeout(() => {
        if (mockOpenRequest.onerror) {
          mockOpenRequest.onerror({ target: mockOpenRequest } as any);
        }
      }, 0);

      await expect(initPromise).rejects.toThrow();
    });

    it("handles invalid database name", async () => {
      const dbWithInvalidName = new IndexedDBLocalDatabase({ dbName: "" });

      mockOpenRequest.error = new Error("Invalid database name");

      const initPromise = dbWithInvalidName.init();

      setTimeout(() => {
        if (mockOpenRequest.onerror) {
          mockOpenRequest.onerror({ target: mockOpenRequest } as any);
        }
      }, 0);

      await expect(initPromise).rejects.toThrow();
    });
  });

  describe("Configuration", () => {
    it("uses custom configuration", async () => {
      const customOptions: IndexedDBLocalDatabaseOptions = {
        dbName: "custom-db",
        version: 2,
        storeName: "custom-snapshots",
        metaStoreName: "custom-metadata",
        debug: true,
      };

      const customDb = new IndexedDBLocalDatabase(customOptions);

      mockDB.objectStoreNames.contains.mockReturnValue(true);

      const initPromise = customDb.init();

      setTimeout(() => {
        if (mockOpenRequest.onsuccess) {
          mockOpenRequest.onsuccess({ target: mockOpenRequest } as any);
        }
      }, 0);

      await expect(initPromise).resolves.toBeUndefined();

      expect(mockIDB.open).toHaveBeenCalledWith("custom-db", 2);
    });
  });
});