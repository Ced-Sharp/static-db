/**
 * Static DB - Git-Backed Local-First CMS Data Layer
 *
 * Node.js entry point with full API access including Node-specific functionality.
 */

export * from "./core/errors.js";
export * from "./core/interfaces.js";
// Core types and interfaces
export * from "./core/types.js";
// Local database implementations (Node.js compatible)
export * from "./local/memory.js";
export * from "./local/node-file.js";
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
 * Library metadata.
 */
export const LIB_INFO = {
  name: "static-db",
  version: VERSION,
  description: "Git-Backed Local-First CMS Data Layer",
  repository: "https://github.com/your-org/static-db",
  documentation: "https://your-org.github.io/static-db",
} as const;
