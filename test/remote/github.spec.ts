import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  NetworkError,
  OutOfDateError,
  RemoteConfigurationError,
} from "../../src/core/errors";
import type { RemoteSnapshot } from "../../src/core/types";
import {
  GitHubRemoteDatabase,
  type GitHubRemoteDatabaseOptions,
} from "../../src/remote/github";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHubRemoteDatabase", () => {
  const defaultOptions: GitHubRemoteDatabaseOptions = {
    owner: "testowner",
    repo: "testrepo",
    token: "test-token",
    branch: "main",
    schemasDir: "schemas",
    contentDir: "content",
  };

  let db: GitHubRemoteDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new GitHubRemoteDatabase(defaultOptions);
  });

  describe("Constructor", () => {
    it("creates instance with valid options", () => {
      expect(db).toBeInstanceOf(GitHubRemoteDatabase);
    });

    it("throws error for missing required options", () => {
      expect(
        () => new GitHubRemoteDatabase({} as GitHubRemoteDatabaseOptions),
      ).toThrow(RemoteConfigurationError);
      expect(
        () =>
          new GitHubRemoteDatabase({
            owner: "test",
          } as GitHubRemoteDatabaseOptions),
      ).toThrow(RemoteConfigurationError);
      expect(
        () =>
          new GitHubRemoteDatabase({
            owner: "test",
            repo: "test",
          } as GitHubRemoteDatabaseOptions),
      ).toThrow(RemoteConfigurationError);
    });

    it("uses default values for optional options", () => {
      const dbWithDefaults = new GitHubRemoteDatabase({
        owner: "testowner",
        repo: "testrepo",
        token: "test-token",
      });

      expect(dbWithDefaults).toBeInstanceOf(GitHubRemoteDatabase);
    });
  });

  describe("Initialization", () => {
    it("initializes successfully with valid authentication", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      await expect(db.init()).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/testowner/testrepo",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "token test-token",
            "User-Agent": "static-db",
          }),
        }),
      );
    });

    it("handles authentication errors", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      await expect(db.init()).rejects.toThrow(AuthenticationError);
    });

    it("handles repository not found errors", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(db.init()).rejects.toThrow(RemoteConfigurationError);
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(db.init()).rejects.toThrow(NetworkError);
    });
  });

  describe("Health Check (ping)", () => {
    beforeEach(async () => {
      // Initialize before each ping test
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });
      await db.init();
    });

    it("passes health check successfully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      await expect(db.ping()).resolves.toBeUndefined();
    });

    it("fails health check with authentication error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      await expect(db.ping()).rejects.toThrow(AuthenticationError);
    });
  });

  describe("Fetching Snapshot", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });
      await db.init();
    });

    it("fetches snapshot with schemas and records", async () => {
      // Mock ref request
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            object: { sha: "abc123def456" },
          }),
        })
        // Mock schemas directory request
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { name: "product.json", type: "file" },
            { name: "category.json", type: "file" },
          ],
        })
        // Mock schema file requests
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: Buffer.from(
              JSON.stringify({
                name: "product",
                fields: [
                  { name: "title", type: "string", required: true },
                  { name: "price", type: "number", required: true },
                ],
              }),
            ).toString("base64"),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: Buffer.from(
              JSON.stringify({
                name: "category",
                fields: [{ name: "name", type: "string", required: true }],
              }),
            ).toString("base64"),
          }),
        })
        // Mock content directory request
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { name: "product", type: "dir" },
            { name: "category", type: "dir" },
          ],
        })
        // Mock subdirectory requests
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { name: "prod-1.json", type: "file" },
            { name: "prod-2.json", type: "file" },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ name: "cat-1.json", type: "file" }],
        })
        // Mock record file requests
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: Buffer.from(
              JSON.stringify({
                id: "prod-1",
                schema: "product",
                data: { title: "Test Product 1", price: 29.99 },
                createdAt: "2023-01-01T00:00:00.000Z",
                updatedAt: "2023-01-01T00:00:00.000Z",
              }),
            ).toString("base64"),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: Buffer.from(
              JSON.stringify({
                id: "prod-2",
                schema: "product",
                data: { title: "Test Product 2", price: 39.99 },
                createdAt: "2023-01-01T00:00:00.000Z",
                updatedAt: "2023-01-01T00:00:00.000Z",
              }),
            ).toString("base64"),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: Buffer.from(
              JSON.stringify({
                id: "cat-1",
                schema: "category",
                data: { name: "Test Category" },
                createdAt: "2023-01-01T00:00:00.000Z",
                updatedAt: "2023-01-01T00:00:00.000Z",
              }),
            ).toString("base64"),
          }),
        });

      const snapshot = await db.fetchSnapshot();

      expect(snapshot.commitId).toBe("abc123def456");
      expect(snapshot.schemas).toHaveLength(2);
      expect(snapshot.records).toHaveLength(3);
      expect(snapshot.schemas[0].name).toBe("product");
      expect(snapshot.schemas[1].name).toBe("category");
      expect(snapshot.meta?.fetchedAt).toBeDefined();
      expect(snapshot.meta?.size?.schemasCount).toBe(2);
      expect(snapshot.meta?.size?.recordsCount).toBe(3);
    });

    it("handles missing schemas directory", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            object: { sha: "abc123" },
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [], // Empty content directory
        });

      const snapshot = await db.fetchSnapshot();

      expect(snapshot.commitId).toBe("abc123");
      expect(snapshot.schemas).toHaveLength(0);
      expect(snapshot.records).toHaveLength(0);
    });

    it("handles missing content directory", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            object: { sha: "abc123" },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [], // Empty schemas directory
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      const snapshot = await db.fetchSnapshot();

      expect(snapshot.commitId).toBe("abc123");
      expect(snapshot.schemas).toHaveLength(0);
      expect(snapshot.records).toHaveLength(0);
    });

    it("handles malformed schema files", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            object: { sha: "abc123" },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ name: "invalid.json", type: "file" }],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: Buffer.from("invalid json").toString("base64"),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [], // Empty content directory
        });

      // Should skip invalid schema files
      await expect(db.fetchSnapshot()).rejects.toThrow();
    });
  });

  describe("Pushing Snapshot", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });
      await db.init();
    });

    it("pushes snapshot successfully", async () => {
      const testSnapshot: Omit<RemoteSnapshot, "commitId"> = {
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
            data: { title: "New Product", price: 49.99 },
            createdAt: "2023-01-01T00:00:00.000Z",
            updatedAt: "2023-01-01T00:00:00.000Z",
          },
        ],
      };

      mockFetch
        // Get current head
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            object: { sha: "base123" },
          }),
        })
        // Create tree
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sha: "tree456" }),
        })
        // Create commit
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sha: "commit789" }),
        })
        // Update reference
        .mockResolvedValueOnce({
          ok: true,
        });

      const result = await db.pushSnapshot("base123", testSnapshot);

      expect(result.newCommitId).toBe("commit789");
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("handles out-of-date error", async () => {
      const testSnapshot: Omit<RemoteSnapshot, "commitId"> = {
        schemas: [],
        records: [],
      };

      mockFetch
        // Get current head (different from base)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            object: { sha: "current789" },
          }),
        });

      await expect(db.pushSnapshot("base123", testSnapshot)).rejects.toThrow(
        OutOfDateError,
      );
    });

    it("validates snapshot before pushing", async () => {
      // Using 'as unknown' since we are forcing an invalid value
      const invalidSnapshot = {
        schemas: "not-an-array",
        records: [],
      } as unknown as Omit<RemoteSnapshot, "commitId">;

      await expect(db.pushSnapshot("base123", invalidSnapshot)).rejects.toThrow(
        "Invalid snapshot: schemas must be an array",
      );
    });

    it("handles push failures", async () => {
      const testSnapshot: Omit<RemoteSnapshot, "commitId"> = {
        schemas: [],
        records: [],
      };

      mockFetch
        // Get current head
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            object: { sha: "base123" },
          }),
        })
        // Create tree fails
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
        });

      await expect(db.pushSnapshot("base123", testSnapshot)).rejects.toThrow();
    });
  });

  describe("Validation", () => {
    it("validates schema structure", () => {
      const validSnapshot = {
        schemas: [
          {
            name: "test",
            fields: [{ name: "field1", type: "string" }],
          },
        ],
        records: [
          {
            id: "rec1",
            schema: "test",
            data: { field1: "value" },
            createdAt: "2023-01-01T00:00:00.000Z",
            updatedAt: "2023-01-01T00:00:00.000Z",
          },
        ],
      };

      // @ts-expect-error - Using private method
      expect(() => db.validateSnapshot(validSnapshot)).not.toThrow();
    });

    it("rejects invalid schema structure", () => {
      const invalidSnapshot = {
        schemas: [
          {
            // Missing name
            fields: [{ name: "field1", type: "string" }],
          },
        ],
        records: [],
      };

      // @ts-expect-error - Private method
      expect(() => db.validateSnapshot(invalidSnapshot)).toThrow(
        "Invalid schema: name is required and must be a string",
      );
    });

    it("rejects invalid record structure", () => {
      const invalidSnapshot = {
        schemas: [
          {
            name: "test",
            fields: [{ name: "field1", type: "string" }],
          },
        ],
        records: [
          {
            // Missing id
            schema: "test",
            data: { field1: "value" },
            createdAt: "2023-01-01T00:00:00.000Z",
            updatedAt: "2023-01-01T00:00:00.000Z",
          },
        ],
      };

      // @ts-expect-error - Private method
      expect(() => db.validateSnapshot(invalidSnapshot)).toThrow(
        "Invalid record: id is required and must be a string",
      );
    });
  });

  describe("Configuration", () => {
    it("uses custom API base URL", () => {
      const customDb = new GitHubRemoteDatabase({
        ...defaultOptions,
        apiBaseUrl: "https://github.enterprise.com/api/v3",
      });

      expect(customDb).toBeInstanceOf(GitHubRemoteDatabase);
    });

    it("uses custom directory paths", () => {
      const customDb = new GitHubRemoteDatabase({
        ...defaultOptions,
        schemasDir: "cms/schemas",
        contentDir: "cms/content",
      });

      expect(customDb).toBeInstanceOf(GitHubRemoteDatabase);
    });

    it("uses custom commit messages", () => {
      const customDb = new GitHubRemoteDatabase({
        ...defaultOptions,
        commitMessage: {
          create: "Add {schema} {id}",
          update: "Modify {schema} {id}",
          delete: "Remove {schema} {id}",
        },
      });

      expect(customDb).toBeInstanceOf(GitHubRemoteDatabase);
    });
  });

  describe("Destroy", () => {
    it("destroys database instance", async () => {
      await db.init();
      await db.destroy();

      // Should not throw and database should be marked as uninitialized
      await expect(db.init()).resolves.toBeUndefined();
    });
  });
});
