import { beforeAll, describe, expect, it, vi } from "vitest";
// Import core functionality
import {
  BROWSER_ERROR_HANDLING,
  BROWSER_UTILS,
  CMSValidator,
  DefaultSyncService,
  MemoryLocalDatabase,
  VERSION,
} from "../src/browser";

// Mock browser APIs for testing
beforeAll(() => {
  // Ensure btoa exists in Node test environment
  const win = globalThis as unknown as { btoa?: (str: string) => string };
  if (!win.btoa) {
    win.btoa = (str: string) => Buffer.from(str, "binary").toString("base64");
  }

  // Mock IndexedDB
  const mockObjectStore = {
    get: vi.fn(),
    put: vi.fn(),
    clear: vi.fn(),
    createIndex: vi.fn(),
  };

  const mockTransaction = {
    objectStore: vi.fn(() => mockObjectStore),
    oncomplete: () => {},
    onerror: () => {},
  };

  const mockDB = {
    close: vi.fn(),
    objectStoreNames: {
      contains: vi.fn(() => true),
    },
    transaction: vi.fn(() => mockTransaction),
  };

  const mockOpenRequest = {
    onsuccess: vi.fn(),
    onerror: vi.fn(),
    onupgradeneeded: vi.fn(),
    result: mockDB,
  };

  const indexedDBWin = globalThis as unknown as { indexedDB?: IDBFactory };
  indexedDBWin.indexedDB = {
    open: vi.fn(() => mockOpenRequest) as unknown as IDBFactory["open"],
  } as IDBFactory;

  // Mock navigator storage API
  vi.stubGlobal("navigator", {
    storage: {
      estimate: vi.fn(() =>
        Promise.resolve({
          quota: 1000000000, // 1GB
          usage: 10000000, // 10MB
        }),
      ),
      persist: vi.fn(() => Promise.resolve(true)),
    } as unknown as Navigator["storage"],
  } as Navigator);
});

describe("Browser Entry Point", () => {
  describe("Exports", () => {
    it("exports VERSION constant", () => {
      expect(VERSION).toBe("1.0.0");
      expect(typeof VERSION).toBe("string");
    });

    it("exports core functionality", () => {
      expect(CMSValidator).toBeDefined();
      expect(MemoryLocalDatabase).toBeDefined();
      expect(DefaultSyncService).toBeDefined();
    });
  });

  describe("Browser Utilities", () => {
    describe("isIndexedDBAvailable", () => {
      it("returns true when IndexedDB is available", () => {
        expect(BROWSER_UTILS.isIndexedDBAvailable()).toBe(true);
      });

      it("returns false when IndexedDB is not available", () => {
        // Temporarily remove IndexedDB
        const win = globalThis as unknown as { indexedDB?: IDBFactory };
        const originalIndexedDB = win.indexedDB;
        delete win.indexedDB;

        expect(BROWSER_UTILS.isIndexedDBAvailable()).toBe(false);

        // Restore IndexedDB
        win.indexedDB = originalIndexedDB;
      });
    });

    describe("isCryptoAvailable", () => {
      it("returns true when Web Crypto API is available", () => {
        expect(BROWSER_UTILS.isCryptoAvailable()).toBe(true);
      });

      it("returns false when Web Crypto API is not available", () => {
        const win = globalThis as unknown as { crypto?: Crypto };
        const originalCrypto = win.crypto;
        delete win.crypto;

        expect(BROWSER_UTILS.isCryptoAvailable()).toBe(false);

        win.crypto = originalCrypto;
      });
    });

    describe("getStorageInfo", () => {
      it("returns storage information when available", async () => {
        const storageInfo = await BROWSER_UTILS.getStorageInfo();

        expect(storageInfo.available).toBe(true);
        expect(typeof storageInfo.quota).toBe("number");
        expect(typeof storageInfo.usage).toBe("number");
      });

      it("returns unavailable when storage API is not present", async () => {
        const win = globalThis as unknown as { navigator?: Navigator };
        const originalNavigator = win.navigator;
        delete win.navigator;

        const storageInfo = await BROWSER_UTILS.getStorageInfo();

        expect(storageInfo.available).toBe(false);

        win.navigator = originalNavigator;
      });

      it("handles storage estimate errors gracefully", async () => {
        const win = globalThis as unknown as { navigator: Navigator };
        const originalEstimate = win.navigator.storage.estimate;
        win.navigator.storage.estimate = vi.fn(() =>
          Promise.reject(new Error("Storage estimate failed")),
        );

        const storageInfo = await BROWSER_UTILS.getStorageInfo();

        expect(storageInfo.available).toBe(false);

        win.navigator.storage.estimate = originalEstimate;
      });
    });

    describe("requestPersistentStorage", () => {
      it("requests persistent storage successfully", async () => {
        const result = await BROWSER_UTILS.requestPersistentStorage();
        expect(result).toBe(true);
      });

      it("returns false when persistence API is not available", async () => {
        const win = globalThis as unknown as { navigator?: Navigator };
        const originalNavigator = win.navigator;
        delete win.navigator;

        const result = await BROWSER_UTILS.requestPersistentStorage();
        expect(result).toBe(false);

        win.navigator = originalNavigator;
      });

      it("handles persistence request failures", async () => {
        const win = globalThis as unknown as { navigator: Navigator };
        const originalPersist = win.navigator.storage.persist;
        win.navigator.storage.persist = vi.fn(() =>
          Promise.reject(new Error("Persistence denied")),
        );

        const result = await BROWSER_UTILS.requestPersistentStorage();
        expect(result).toBe(false);

        win.navigator.storage.persist = originalPersist;
      });
    });
  });

  describe("Browser Error Handling", () => {
    describe("handleIndexedDBError", () => {
      it("handles QuotaExceededError", () => {
        const error = new DOMException(
          "Storage quota exceeded",
          "QuotaExceededError",
        );
        const message = BROWSER_ERROR_HANDLING.handleIndexedDBError(error);

        expect(message).toContain("Storage quota exceeded");
        expect(message).toContain("free up some space");
      });

      it("handles InvalidStateError", () => {
        const error = new DOMException("Invalid state", "InvalidStateError");
        const message = BROWSER_ERROR_HANDLING.handleIndexedDBError(error);

        expect(message).toContain("invalid state");
        expect(message).toContain("refresh the page");
      });

      it("handles VersionError", () => {
        const error = new DOMException("Version mismatch", "VersionError");
        const message = BROWSER_ERROR_HANDLING.handleIndexedDBError(error);

        expect(message).toContain("version mismatch");
        expect(message).toContain("refresh the page");
      });

      it("handles AbortError", () => {
        const error = new DOMException("Operation aborted", "AbortError");
        const message = BROWSER_ERROR_HANDLING.handleIndexedDBError(error);

        expect(message).toContain("aborted");
        expect(message).toContain("try again");
      });

      it("handles generic DOMException", () => {
        const error = new DOMException("Generic error", "GenericError");
        const message = BROWSER_ERROR_HANDLING.handleIndexedDBError(error);

        expect(message).toContain("Database error");
        expect(message).toContain("Generic error");
      });

      it("handles non-DOMException errors", () => {
        const error = new Error("Regular error");
        const message = BROWSER_ERROR_HANDLING.handleIndexedDBError(error);

        expect(message).toBe("Regular error");
      });

      it("handles non-Error objects", () => {
        const message =
          BROWSER_ERROR_HANDLING.handleIndexedDBError("string error");
        expect(message).toBe("Unknown error occurred");
      });
    });

    describe("isRecoverableError", () => {
      it("identifies recoverable DOMException errors", () => {
        const recoverableErrors = [
          new DOMException("Quota exceeded", "QuotaExceededError"),
          new DOMException("Network error", "NetworkError"),
          new DOMException("Timeout", "TimeoutError"),
          new DOMException("Aborted", "AbortError"),
        ];

        recoverableErrors.forEach((error) => {
          expect(BROWSER_ERROR_HANDLING.isRecoverableError(error)).toBe(true);
        });
      });

      it("identifies non-recoverable DOMException errors", () => {
        const nonRecoverableErrors = [
          new DOMException("Invalid state", "InvalidStateError"),
          new DOMException("Version mismatch", "VersionError"),
          new DOMException("Not found", "NotFoundError"),
        ];

        nonRecoverableErrors.forEach((error) => {
          expect(BROWSER_ERROR_HANDLING.isRecoverableError(error)).toBe(false);
        });
      });

      it("handles non-DOMException errors", () => {
        expect(
          BROWSER_ERROR_HANDLING.isRecoverableError(new Error("Generic error")),
        ).toBe(false);
        expect(BROWSER_ERROR_HANDLING.isRecoverableError("string error")).toBe(
          false,
        );
        expect(BROWSER_ERROR_HANDLING.isRecoverableError(null)).toBe(false);
      });
    });
  });

  describe("Browser-specific Functionality", () => {
    it("creates validator instance in browser context", () => {
      const validator = new CMSValidator();
      expect(validator).toBeDefined();

      // Should be able to register schemas
      expect(() => {
        validator.registerSchema({
          name: "product",
          fields: [{ name: "title", type: "string", required: true }],
        });
      }).not.toThrow();
    });

    it("creates memory database instance in browser context", () => {
      const db = new MemoryLocalDatabase({ debug: true });
      expect(db).toBeDefined();

      // Should be able to initialize
      return expect(db.init()).resolves.toBeUndefined();
    });

    it("checks browser capabilities before operations", async () => {
      // Verify IndexedDB is available
      expect(BROWSER_UTILS.isIndexedDBAvailable()).toBe(true);

      // Verify Crypto API is available
      expect(BROWSER_UTILS.isCryptoAvailable()).toBe(true);

      // Get storage info
      const storageInfo = await BROWSER_UTILS.getStorageInfo();
      expect(storageInfo.available).toBe(true);

      // Try to request persistent storage
      const persistent = await BROWSER_UTILS.requestPersistentStorage();
      expect(typeof persistent).toBe("boolean");
    });
  });

  describe("Memory Usage and Performance", () => {
    it("provides storage information for monitoring", async () => {
      const storageInfo = await BROWSER_UTILS.getStorageInfo();

      if (storageInfo.available) {
        expect(typeof storageInfo.quota).toBe("number");
        expect(typeof storageInfo.usage).toBe("number");

        if (storageInfo.quota && storageInfo.usage) {
          // Usage should be less than quota
          expect(storageInfo.usage).toBeLessThanOrEqual(storageInfo.quota);

          // Should be reasonable values (non-negative)
          expect(storageInfo.quota).toBeGreaterThan(0);
          expect(storageInfo.usage).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("handles storage quota issues gracefully", async () => {
      // Mock quota exceeded error
      const quotaError = new DOMException(
        "Quota exceeded",
        "QuotaExceededError",
      );
      const message = BROWSER_ERROR_HANDLING.handleIndexedDBError(quotaError);

      expect(message).toContain("quota exceeded");
      expect(message).toContain("Please free up some space");
    });
  });

  describe("Cross-browser Compatibility", () => {
    it("handles missing APIs gracefully", () => {
      // Test with missing IndexedDB
      const indexedDBWin = globalThis as unknown as { indexedDB?: IDBFactory };
      const originalIndexedDB = indexedDBWin.indexedDB;
      delete indexedDBWin.indexedDB;

      expect(BROWSER_UTILS.isIndexedDBAvailable()).toBe(false);

      // Restore
      indexedDBWin.indexedDB = originalIndexedDB;

      // Test with missing Crypto API
      const cryptoWin = globalThis as unknown as { crypto?: Crypto };
      const originalCrypto = cryptoWin.crypto;
      delete cryptoWin.crypto;

      expect(BROWSER_UTILS.isCryptoAvailable()).toBe(false);

      // Restore
      cryptoWin.crypto = originalCrypto;
    });
  });

  describe("Environment Detection", () => {
    it("detects browser environment capabilities", () => {
      // Should have self in browser/worker environment
      expect(typeof self).toBeDefined();

      // Should have access to browser APIs
      expect(typeof navigator).toBeDefined();

      // Check utilities work in this environment
      const hasIndexedDB = BROWSER_UTILS.isIndexedDBAvailable();
      const hasCrypto = BROWSER_UTILS.isCryptoAvailable();

      expect(typeof hasIndexedDB).toBe("boolean");
      expect(typeof hasCrypto).toBe("boolean");
    });
  });
});
