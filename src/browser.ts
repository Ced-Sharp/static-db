/**
 * Static DB - Git-Backed Local-First CMS Data Layer
 *
 * Browser entry point optimized for client-side usage.
 * Excludes Node-specific functionality and includes browser-optimized implementations.
 */

export * from "./core/errors.js";
export * from "./core/interfaces.js";
// Core types and interfaces
export * from "./core/types.js";
// Local database implementations (browser-focused)
export * from "./local/indexeddb.js";
export * from "./local/memory.js";
// Remote database implementations
export * from "./remote/base.js";
export * from "./remote/github.js";

// Sync service
export * from "./sync/service.js";

// Utilities
export * from "./utils/validation.js";

/**
 * Version information for the Static DB library.
 */
export const VERSION = "1.0.0";

/**
 * Browser-specific utilities.
 */
export const BROWSER_UTILS = {
  /**
   * Check if IndexedDB is available in the current environment.
   */
  isIndexedDBAvailable(): boolean {
    return "indexedDB" in self && indexedDB !== null;
  },

  /**
   * Check if the current environment supports Web Crypto API.
   */
  isCryptoAvailable(): boolean {
    return "crypto" in self && crypto.subtle !== undefined;
  },

  /**
   * Get browser storage information if available.
   */
  async getStorageInfo(): Promise<{
    quota?: number;
    usage?: number;
    available?: boolean;
  }> {
    if ("storage" in navigator && "estimate" in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        return {
          quota: estimate.quota || undefined,
          usage: estimate.usage || undefined,
          available: true,
        };
      } catch {
        return { available: false };
      }
    }
    return { available: false };
  },

  /**
   * Request persistent storage if available (important for CMS data).
   */
  async requestPersistentStorage(): Promise<boolean> {
    if ("storage" in navigator && "persist" in navigator.storage) {
      try {
        return await navigator.storage.persist();
      } catch {
        return false;
      }
    }
    return false;
  },
} as const;

/**
 * Browser-specific error handling.
 */
export const BROWSER_ERROR_HANDLING = {
  /**
   * Handle IndexedDB errors with browser-specific context.
   */
  handleIndexedDBError(error: unknown): string {
    if (error instanceof DOMException) {
      switch (error.name) {
        case "QuotaExceededError":
          return "Storage quota exceeded. Please free up some space or delete unused data.";
        case "InvalidStateError":
          return "Database is in an invalid state. Please refresh the page and try again.";
        case "VersionError":
          return "Database version mismatch. Please refresh the page.";
        case "AbortError":
          return "Operation was aborted. Please try again.";
        default:
          return `Database error: ${error.message}`;
      }
    }
    return error instanceof Error ? error.message : "Unknown error occurred";
  },

  /**
   * Check if an error is recoverable (user can retry).
   */
  isRecoverableError(error: unknown): boolean {
    if (error instanceof DOMException) {
      const recoverableErrors = [
        "QuotaExceededError",
        "NetworkError",
        "TimeoutError",
        "AbortError",
      ];
      return recoverableErrors.includes(error.name);
    }
    return false;
  },
} as const;
