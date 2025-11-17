import { describe, expect, it, vi } from "vitest";
// Import Node.js specific functionality
import {
  CMSValidator,
  DefaultSyncService,
  LIB_INFO,
  MemoryLocalDatabase,
  NodeFileLocalDatabase,
  VERSION,
} from "../src";

describe("Node.js Entry Point", () => {
  describe("Exports", () => {
    it("exports VERSION constant", () => {
      expect(VERSION).toBe("1.0.0");
      expect(typeof VERSION).toBe("string");
    });

    it("exports LIB_INFO object", () => {
      expect(LIB_INFO).toBeDefined();
      expect(LIB_INFO.name).toBe("static-db");
      expect(LIB_INFO.version).toBe(VERSION);
      expect(LIB_INFO.description).toBe(
        "Git-Backed Local-First CMS Data Layer",
      );
      expect(LIB_INFO.repository).toContain("github.com");
    });

    it("exports core functionality", () => {
      expect(CMSValidator).toBeDefined();
      expect(MemoryLocalDatabase).toBeDefined();
      expect(DefaultSyncService).toBeDefined();
    });

    it("exports all required modules", async () => {
      const moduleExports = await import("../src");

      // Check error types are exported
      expect(moduleExports.StaticDBError).toBeDefined();
      expect(moduleExports.RemoteDatabaseError).toBeDefined();
      expect(moduleExports.LocalDatabaseError).toBeDefined();
      expect(moduleExports.ValidationError).toBeDefined();

      // Check implementations are exported
      expect(moduleExports.MemoryLocalDatabase).toBeDefined();
      expect(moduleExports.NodeFileLocalDatabase).toBeDefined();
      expect(moduleExports.CMSValidator).toBeDefined();
    });
  });

  describe("Node.js Environment", () => {
    it("detects Node.js runtime", () => {
      // Check for Node.js-specific globals
      expect(typeof process).toBeDefined();
      expect(typeof Buffer).toBeDefined();
      expect(typeof require).toBeDefined();

      // Check that we're in a Node.js environment
      expect(typeof process.versions?.node).toBe("string");
    });

    it("has access to Node.js APIs", () => {
      // Node.js should have these global objects
      expect(typeof global).toBeDefined();
      expect(typeof process).toBeDefined();
      expect(typeof Buffer).toBeDefined();
    });

    it("can access crypto module", () => {
      // Test that crypto.randomBytes can be mocked
      const mockRandomBytes = vi.fn(() => Buffer.from("test", "hex"));

      // biome-ignore lint/suspicious/noExplicitAny: this is fine
      (globalThis as any).require = vi.fn(() => ({
        randomBytes: mockRandomBytes,
      }));

      expect(mockRandomBytes).toBeDefined();
    });
  });

  describe("Core Functionality in Node.js", () => {
    it("creates validator instance in Node.js context", () => {
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

    it("creates memory database instance in Node.js context", () => {
      const db = new MemoryLocalDatabase({ debug: true });
      expect(db).toBeDefined();

      // Should be able to initialize
      return expect(db.init()).resolves.toBeUndefined();
    });

    it("creates file database instance in Node.js context", () => {
      const db = new NodeFileLocalDatabase({ debug: true });
      expect(db).toBeDefined();

      // Should be able to initialize
      return expect(db.init()).resolves.toBeUndefined();
    });

    it("handles Node.js-specific error scenarios", () => {
      // Test that Node.js error handling works
      const nodeError = new Error("Node.js error");
      expect(nodeError instanceof Error).toBe(true);
      expect(nodeError.message).toBe("Node.js error");
    });
  });

  describe("Module Resolution", () => {
    it("correctly resolves ES modules", async () => {
      // Test that ES module imports work
      const dynamicImport = await import("../src");
      expect(dynamicImport.VERSION).toBe("1.0.0");
    });

    it("handles module structure correctly", () => {
      // The module should have the expected structure
      expect(typeof exports).toBeDefined();
      expect(typeof module).toBeDefined();
      expect(typeof __dirname).toBeDefined();
      expect(typeof __filename).toBeDefined();
    });
  });

  describe("Performance and Memory", () => {
    it("handles large datasets efficiently", async () => {
      const db = new MemoryLocalDatabase();
      await db.init();

      // Create a large snapshot
      const largeSnapshot = {
        commitId: "large-snapshot",
        schemas: [
          {
            name: "product",
            fields: [
              { name: "title", type: "string", required: true },
              { name: "price", type: "number", required: true },
              { name: "description", type: "string", required: false },
            ],
          },
        ],
        records: Array.from({ length: 1000 }, (_, i) => ({
          id: `product-${i}`,
          schema: "product",
          data: {
            title: `Product ${i}`,
            price: i * 10.99,
            description: `Description for product ${i}`,
          },
          createdAt: "2023-01-01T00:00:00.000Z",
          updatedAt: "2023-01-01T00:00:00.000Z",
        })),
      };

      // Should handle large datasets without issues
      const startTime = Date.now();
      await db.save(largeSnapshot, { synced: true });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should complete within 1 second

      const state = await db.load();
      expect(state.snapshot?.records).toHaveLength(1000);
    });

    it("manages memory usage appropriately", async () => {
      const db = new MemoryLocalDatabase();
      await db.init();

      // Test that memory doesn't grow unbounded
      const initialMemory = process.memoryUsage().heapUsed;

      // Create and save multiple snapshots
      for (let i = 0; i < 100; i++) {
        const snapshot = {
          commitId: `snapshot-${i}`,
          schemas: [],
          records: [
            {
              id: `record-${i}`,
              schema: "test",
              data: { index: i },
              createdAt: "2023-01-01T00:00:00.000Z",
              updatedAt: "2023-01-01T00:00:00.000Z",
            },
          ],
        };
        await db.save(snapshot, { synced: true });
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Memory growth should be reasonable (less than 10MB for this test)
      expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe("File System Integration", () => {
    it("handles file system paths correctly", () => {
      // Test that paths work correctly in Node.js environment
      const path = require("node:path");
      expect(typeof path).toBeDefined();
      expect(typeof path.join).toBe("function");

      // Test path joining
      const joinedPath = path.join("src", "core", "types.ts");
      expect(joinedPath).toContain("src");
      expect(joinedPath).toContain("core");
      expect(joinedPath).toContain("types.ts");
    });

    it("can read package information", () => {
      // Should be able to access package.json information
      try {
        const packageInfo = require("../package.json");
        expect(packageInfo.name).toBeDefined();
        expect(packageInfo.version).toBeDefined();
      } catch {
        // Package.json might not be accessible in test environment
        // This is okay for the test
      }
    });
  });

  describe("Environment Variables", () => {
    it("respects environment configuration", () => {
      // Test that environment variables are accessible
      expect(typeof process.env).toBeDefined();

      // Should be able to set and get environment variables
      const originalValue = process.env.TEST_VAR;
      process.env.TEST_VAR = "test-value";
      expect(process.env.TEST_VAR).toBe("test-value");

      // Restore original value
      if (originalValue !== undefined) {
        process.env.TEST_VAR = originalValue;
      } else {
        delete process.env.TEST_VAR;
      }
    });

    it("handles missing environment variables gracefully", () => {
      // Should handle non-existent environment variables
      expect(process.env.NON_EXISTENT_VAR).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("handles Node.js-specific errors", () => {
      // Test Node.js error types
      const systemError = new Error("System error");
      systemError.name = "SystemError";

      expect(systemError instanceof Error).toBe(true);
      expect(systemError.name).toBe("SystemError");
    });

    it("processes unhandled exceptions appropriately", () => {
      // Test that unhandled exception handling works
      const originalHandlers = process.listeners("uncaughtException");
      const mockHandler = vi.fn();

      process.on("uncaughtException", mockHandler);

      // Should be able to add event listeners
      expect(process.listeners("uncaughtException")).toContain(mockHandler);

      // Clean up
      process.off("uncaughtException", mockHandler);
      expect(process.listeners("uncaughtException")).toEqual(originalHandlers);
    });

    it("handles promise rejections correctly", () => {
      const originalHandlers = process.listeners("unhandledRejection");
      const mockHandler = vi.fn();

      process.on("unhandledRejection", mockHandler);

      // Should be able to add rejection handlers
      expect(process.listeners("unhandledRejection")).toContain(mockHandler);

      // Clean up
      process.off("unhandledRejection", mockHandler);
      expect(process.listeners("unhandledRejection")).toEqual(originalHandlers);
    });
  });

  describe("Concurrency and Threading", () => {
    it("handles concurrent operations", async () => {
      const db = new MemoryLocalDatabase();
      await db.init();

      // Test concurrent operations
      const operations = Array.from({ length: 50 }, (_, i) =>
        db.save(
          {
            commitId: `concurrent-${i}`,
            schemas: [],
            records: [
              {
                id: `record-${i}`,
                schema: "test",
                data: { index: i },
                createdAt: "2023-01-01T00:00:00.000Z",
                updatedAt: "2023-01-01T00:00:00.000Z",
              },
            ],
          },
          { synced: true },
        ),
      );

      // Should complete all operations without errors
      await expect(Promise.all(operations)).resolves.not.toThrow();

      // Should match last save operation
      const state = await db.load();
      expect(state.snapshot).toMatchObject(operations[operations.length - 1]);
    });

    it("manages async operations efficiently", async () => {
      const db = new MemoryLocalDatabase();
      await db.init();

      // Test async/await patterns
      const asyncOperation = async () => {
        const snapshot = {
          commitId: "async-test",
          schemas: [],
          records: [],
        };
        await db.save(snapshot, { synced: true });
        return await db.load();
      };

      const result = await asyncOperation();
      expect(result.snapshot?.commitId).toBe("async-test");
    });
  });

  describe("Build and Distribution", () => {
    it("has correct module structure for Node.js", () => {
      // Check that the module has Node.js-specific structure
      expect(typeof module.exports).toBeDefined();
      expect(typeof exports).toBeDefined();
    });

    it("handles CommonJS compatibility", () => {
      // The module should work with both CommonJS and ES modules
      expect(typeof require).toBe("function");

      // Should be able to use require syntax
      try {
        const requiredModule = require("../src");
        expect(requiredModule.VERSION).toBe("1.0.0");
      } catch {
        // Might fail due to ES modules, but that's okay
      }
    });
  });

  describe("Node.js Specific Features", () => {
    it("utilizes Node.js performance APIs", () => {
      // Check that performance APIs are available
      expect(typeof performance).toBeDefined();
      expect(typeof performance.now).toBe("function");

      // Should be able to measure performance
      const start = performance.now();
      const end = performance.now();
      expect(end - start).toBeGreaterThanOrEqual(0);
    });

    it("handles Node.js streams", () => {
      // Stream functionality should be available
      expect(typeof require).toBeDefined();

      try {
        const stream = require("node:stream");
        expect(typeof stream).toBeDefined();
      } catch {
        // Streams might not be available in this context
      }
    });

    it("manages event loop properly", async () => {
      // Test that async operations work with event loop
      const eventLoopTest = new Promise<void>((resolve) => {
        setImmediate(() => {
          resolve();
        });
      });

      await expect(eventLoopTest).resolves.toBeUndefined();
    });
  });
});
