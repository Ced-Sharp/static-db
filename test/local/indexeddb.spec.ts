import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { RemoteSnapshot } from "../../src/core/types";
import {
  IndexedDBLocalDatabase,
  type IndexedDBLocalDatabaseOptions,
} from "../../src/local/indexeddb";

/**
 * @vitest-environment jsdom
 *
 * Note: These tests are for browser environments only and require IndexedDB APIs.
 * They will not run in Node.js environments unless IndexedDB is polyfilled.
 */

// Mock IndexedDB for testing
const mockObjectStore = {
  get: vi.fn(),
  put: vi.fn(),
  clear: vi.fn(),
  createIndex: vi.fn(),
};

const mockTransaction = {
  objectStore: vi.fn(() => mockObjectStore),
  oncomplete: vi.fn(),
  onerror: vi.fn(),
  onabort: vi.fn(),
};

const mockDB = {
  close: vi.fn(),
  objectStoreNames: {
    contains: vi.fn(),
  },
  transaction: vi.fn(() => mockTransaction),
};

const mockOpenRequest = {
  onsuccess: vi.fn(),
  onerror: vi.fn(),
  onblocked: vi.fn(),
  onupgradeneeded: vi.fn(),
  result: mockDB,
  error: null as Error | null,
};

const mockIDB = {
  open: vi.fn(() => mockOpenRequest),
};

const openDbNormally = (db: IndexedDBLocalDatabase) => {
  mockDB.objectStoreNames.contains.mockReturnValue(true);
  const initPromise = db.init();
  setTimeout(() => {
    mockOpenRequest?.onsuccess({ target: mockOpenRequest });
  }, 0);
  return initPromise;
};

const openDbWithUpgrade = (db: IndexedDBLocalDatabase) => {
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

  setTimeout(() => {
    mockOpenRequest?.onupgradeneeded(mockUpgradeEvent);
    mockOpenRequest?.onsuccess({ target: mockOpenRequest });
  }, 0);

  return initPromise;
};

const openDbWithError = (db: IndexedDBLocalDatabase, error: Error) => {
  mockOpenRequest.error = error;
  const initPromise = db.init();
  setTimeout(() => {
    mockOpenRequest?.onerror({ target: mockOpenRequest });
  }, 0);
  return initPromise;
};

// Replace global indexedDB
beforeAll(() => {
  (globalThis as unknown as { indexedDB?: typeof mockIDB }).indexedDB = mockIDB;
});

afterAll(() => {
  delete (globalThis as unknown as { indexedDB?: typeof mockIDB }).indexedDB;
});

describe.sequential("IndexedDBLocalDatabase", () => {
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

  describe.sequential("Initialization", () => {
    it("initializes database successfully", async () => {
      const promise = openDbNormally(db);
      await expect(promise).resolves.toBeUndefined();
      expect(mockIDB.open).toHaveBeenCalledWith(dbName, 1);
    });

    it("handles database open error", async () => {
      const promise = openDbWithError(db, new Error("Database access denied"));
      await expect(promise).rejects.toThrow("Failed to initialize IndexedDB");
    });

    it("creates object stores on upgrade", async () => {
      const promise = openDbWithUpgrade(db);
      await expect(promise).resolves.toBeUndefined();
    });

    it("can be initialized multiple times", async () => {
      await openDbNormally(db);
      await openDbNormally(db);
      expect(mockIDB.open).toHaveBeenCalledTimes(1);
    });
  });

  describe.sequential("Loading State", () => {
    beforeEach(async () => {
      await openDbNormally(db);
    });

    it("returns empty state on first load", async () => {
      mockObjectStore.get.mockImplementation(() => {
        const request = {
          result: null,
          onsuccess: null as null | ((...args: unknown[]) => void),
          onerror: null as null | ((...args: unknown[]) => void),
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({ target: request });
        }, 0);
        return request;
      });

      const statePromise = db.load();

      // Simulate successful loads
      setTimeout(() => {
        const snapshotRequest = mockObjectStore.get.mock.results[0].value;
        const metaRequest = mockObjectStore.get.mock.results[1].value;

        if (snapshotRequest.onsuccess) {
          snapshotRequest.onsuccess({ target: snapshotRequest });
        }
        if (metaRequest.onsuccess) {
          metaRequest.onsuccess({ target: metaRequest });
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
        let result: unknown = null;
        switch (key) {
          case "current":
            result = { id: key, snapshot: testSnapshot };
            break;
          case "syncState":
            result = { id: key, hasUnsyncedChanges: true };
            break;
        }

        const request = {
          result,
          onsuccess: null as null | ((...args: unknown[]) => void),
          onerror: null as null | ((...args: unknown[]) => void),
        };

        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({ target: request });
        }, 0);

        return request;
      });

      const statePromise = db.load();

      setTimeout(() => {
        const requests = mockObjectStore.get.mock.results;
        requests.forEach((result) => {
          if (result.value.onsuccess) {
            result.value.onsuccess({ target: result.value });
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
          if (request.onsuccess) request.onsuccess({ target: request });
        }, 0);

        return request;
      });

      const statePromise = db.load();

      setTimeout(() => {
        const request = mockObjectStore.get.mock.results[0].value;
        if (request.onsuccess) {
          request.onsuccess({ target: request });
        }
      }, 0);

      const state = await statePromise;

      expect(state.snapshot).toBeNull(); // Should treat corrupted data as null
    });
  });

  describe.sequential("Saving State", () => {
    beforeEach(async () => {
      await openDbNormally(db);
    });

    it("saves snapshot successfully", async () => {
      const testSnapshot: RemoteSnapshot = {
        commitId: "def456",
        schemas: [],
        records: [],
      };

      mockObjectStore.put.mockImplementation(() => {
        return {
          onsuccess: null as null | ((...args: unknown[]) => void),
          onerror: null as null | ((...args: unknown[]) => void),
        };
      });

      const savePromise = db.save(testSnapshot, { synced: true });

      // Make first write (content) a success
      setTimeout(() => {
        const contentRequest =
          mockObjectStore.put.mock.results[0]?.value ?? null;
        expect(contentRequest).not.toBeNull();
        contentRequest?.onsuccess({ target: contentRequest });

        // Then, make second write (metadata) also a success
        setTimeout(() => {
          const metaRequest =
            mockObjectStore.put.mock.results[1]?.value ?? null;
          expect(metaRequest).not.toBeNull();
          metaRequest?.onsuccess({ target: metaRequest });

          // Finally, complete the transaction
          setTimeout(() => {
            mockTransaction.oncomplete?.({});
          }, 0);
        }, 0);
      }, 0);

      await expect(savePromise).resolves.toBeUndefined();

      expect(mockObjectStore.put).toHaveBeenCalledTimes(2); // snapshot + metadata
      expect(mockDB.transaction).toHaveBeenCalledWith(
        ["snapshots", "metadata"],
        "readwrite",
      );
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
          if (request.onerror) request.onerror({ target: request });
        }, 0);
        return request;
      });

      const savePromise = db.save(testSnapshot, { synced: true });

      setTimeout(() => {
        const request = mockObjectStore.put.mock.results[0].value;
        if (request.onerror) {
          request.onerror({ target: request });
        }
      }, 0);

      await expect(savePromise).rejects.toThrow();
    });

    // it("handles transaction errors", async () => {
    // const testSnapshot: RemoteSnapshot = {
    //   commitId: "abc123",
    //   schemas: [{ name: "test", fields: [] }],
    //   records: [],
    // };
    //
    // mockObjectStore.put.mockImplementation(() => {
    //   const request = {
    //     onsuccess: null as null | ((...args: unknown[]) => void),
    //     onerror: null as null | ((...args: unknown[]) => void),
    //   };
    //   setTimeout(() => {
    //     if (request.onsuccess) request.onsuccess({ target: request });
    //   }, 0);
    //   return request;
    // });
    //
    // mockTransaction.onerror = vi.fn(() => {
    //   throw new Error("Transaction failed");
    // });
    //
    // const savePromise = db.save(testSnapshot, { synced: true });
    //
    // setTimeout(() => {
    //   // Complete the puts first
    //   mockObjectStore.put.mock.results.forEach((result) => {
    //     if (result.value.onsuccess) {
    //       result.value.onsuccess({ target: result.value });
    //     }
    //   });
    // }, 0);
    //
    // await expect(savePromise).rejects.toThrow("Failed to save to IndexedDB");
    // });
  });

  // describe.sequential("Clearing State", () => {
  // beforeEach(async () => {
  //   await openDbNormally(db);
  // });
  //
  // it("clears all data", async () => {
  //   mockObjectStore.clear.mockImplementation(() => {
  //     const request = {
  //       onsuccess: null as null | ((...args: unknown[]) => void),
  //       onerror: null as null | ((...args: unknown[]) => void),
  //     };
  //     setTimeout(() => {
  //       if (request.onsuccess) request.onsuccess({ target: request });
  //     }, 0);
  //     return request;
  //   });
  //
  //   mockTransaction.oncomplete = vi.fn();
  //
  //   const clearPromise = db.clear();
  //
  //   setTimeout(() => {
  //     // Simulate successful clears
  //     mockObjectStore.clear.mock.results.forEach((result) => {
  //       if (result.value.onsuccess) {
  //         result.value.onsuccess({ target: result.value });
  //       }
  //     });
  //
  //     // Simulate transaction complete
  //     if (mockTransaction.oncomplete) {
  //       mockTransaction.oncomplete({});
  //     }
  //   }, 0);
  //
  //   await expect(clearPromise).resolves.toBeUndefined();
  //
  //   expect(mockObjectStore.clear).toHaveBeenCalledTimes(2);
  // });
  // });

  // describe.sequential("Destroy", () => {
  // it("closes database connection", async () => {
  //   mockDB.objectStoreNames.contains.mockReturnValue(true);
  //   await db.init();
  //
  //   await db.destroy();
  //
  //   expect(mockDB.close).toHaveBeenCalled();
  // });
  // });

  describe.sequential("Error Handling", () => {
    it("wraps IndexedDB errors appropriately", async () => {
      mockOpenRequest.error = new DOMException(
        "Storage quota exceeded",
        "QuotaExceededError",
      );

      const initPromise = db.init();

      setTimeout(() => {
        if (mockOpenRequest.onerror) {
          mockOpenRequest.onerror({ target: mockOpenRequest });
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
          mockOpenRequest.onerror({ target: mockOpenRequest });
        }
      }, 0);

      await expect(initPromise).rejects.toThrow();
    });
  });

  describe.sequential("Configuration", () => {
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
          mockOpenRequest.onsuccess({ target: mockOpenRequest });
        }
      }, 0);

      await expect(initPromise).resolves.toBeUndefined();

      expect(mockIDB.open).toHaveBeenCalledWith("custom-db", 2);
    });
  });
});
