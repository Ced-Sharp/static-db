import {
  AuthenticationError,
  NetworkError,
  RemoteConfigurationError,
  RemoteDatabaseError,
} from "../core/errors.js";
import type { RemoteDatabaseInitOptions } from "../core/interfaces.js";
import type { RemoteSnapshot } from "../core/types.js";
import { BaseRemoteDatabase } from "./base.js";

/**
 * Configuration options specific to GitHub RemoteDatabase implementation.
 */
export interface GitHubRemoteDatabaseOptions extends RemoteDatabaseInitOptions {
  /** GitHub repository owner (username or organization) */
  owner: string;

  /** GitHub repository name */
  repo: string;

  /** Git branch to work with (default: "main") */
  branch?: string;

  /** Personal access token for authentication */
  token: string;

  /**
   * Base directory in which all other directories are found.
   * Defaults to no base directory (in the root directly)
   */
  baseDir?: string;

  /** Directory path for schema files (default: "schemas") */
  schemasDir?: string;

  /** Directory path for content files (default: "content") */
  contentDir?: string;

  /** Optional custom GitHub API base URL */
  apiBaseUrl?: string;

  /** Optional commit message template */
  commitMessage?: {
    create?: string;
    update?: string;
    delete?: string;
  };
}

/**
 * GitHub implementation of RemoteDatabase using the GitHub REST API.
 *
 * This implementation stores schemas and records as JSON files in a Git repository:
 *
 * <baseDir>/schemas/
 *   product.json
 *   category.json
 * <baseDir>/content/
 *   product/prod-123.json
 *   product/prod-456.json
 *   category/cat-1.json
 *
 * Each sync operation creates a new commit with the updated files.
 */
export class GitHubRemoteDatabase extends BaseRemoteDatabase {
  private readonly githubOptions: Required<
    Omit<GitHubRemoteDatabaseOptions, "label" | "endpointId">
  >;
  private apiBaseUrl: string;

  constructor(options: GitHubRemoteDatabaseOptions) {
    super(options);

    // Validate required options
    if (!options.owner || !options.repo || !options.token) {
      throw new RemoteConfigurationError(
        "GitHub owner, repo, and token are required",
      );
    }

    this.githubOptions = {
      owner: options.owner,
      repo: options.repo,
      branch: options.branch || "main",
      token: options.token,
      baseDir: options.baseDir?.replace(/\/+$/, "") || "",
      schemasDir: options.schemasDir || "schemas",
      contentDir: options.contentDir || "content",
      apiBaseUrl: options.apiBaseUrl || "https://api.github.com",
      commitMessage: {
        create: options.commitMessage?.create || "Create {schema} {id}",
        update: options.commitMessage?.update || "Update {schema} {id}",
        delete: options.commitMessage?.delete || "Delete {schema} {id}",
      },
    };

    const o = this.githubOptions;
    if (o.baseDir) {
      if (!o.schemasDir.startsWith(o.baseDir)) {
        o.schemasDir = `${o.baseDir}/${o.schemasDir}`;
      }

      if (!o.contentDir.startsWith(o.baseDir)) {
        o.contentDir = `${o.baseDir}/${o.contentDir}`;
      }
    }

    this.apiBaseUrl = this.githubOptions.apiBaseUrl;
  }

  protected async doInit(): Promise<void> {
    // Validate connection and authentication
    try {
      await this.ping();
      this.log("GitHub remote database initialized", {
        owner: this.githubOptions.owner,
        repo: this.githubOptions.repo,
        branch: this.githubOptions.branch,
      });
    } catch (error) {
      throw this.wrapError(error, "Failed to initialize GitHub connection");
    }
  }

  async fetchSnapshot(): Promise<RemoteSnapshot> {
    await this.ensureInitialized();

    try {
      // Get current commit SHA
      const commitSha = await this.getHeadCommitSha();
      // Fetch all files from the repository
      const [schemas, records] = await Promise.all([
        this.fetchSchemas(),
        this.fetchRecords(),
      ]);

      return {
        commitId: commitSha,
        schemas,
        records,
        meta: {
          fetchedAt: new Date().toISOString(),
          size: {
            schemasCount: schemas.length,
            recordsCount: records.length,
          },
        },
      };
    } catch (error) {
      throw this.wrapError(error, "Failed to fetch snapshot from GitHub");
    }
  }

  async pushSnapshot(
    baseCommitId: string,
    newSnapshot: Omit<RemoteSnapshot, "commitId">,
  ): Promise<{ newCommitId: string }> {
    await this.ensureInitialized();

    try {
      // Validate the snapshot
      this.validateSnapshot(newSnapshot);

      // Check if we're still on the expected base commit
      const currentHead = await this.getHeadCommitSha();
      if (currentHead !== baseCommitId) {
        throw this.createOutOfDateError(baseCommitId, currentHead);
      }

      // Create git tree with new file contents
      const treeItems = await this.createTreeItems(newSnapshot);
      const treeResponse = await this.createGitTree(treeItems, baseCommitId);

      // Create commit
      const commitResponse = await this.createCommit(
        "Update CMS data",
        treeResponse.sha,
        [baseCommitId],
      );

      // Update reference
      await this.updateReference(this.githubOptions.branch, commitResponse.sha);

      this.log("Successfully pushed snapshot to GitHub", {
        newCommitId: commitResponse.sha,
        schemasCount: newSnapshot.schemas.length,
        recordsCount: newSnapshot.records.length,
      });

      return { newCommitId: commitResponse.sha };
    } catch (error) {
      throw this.wrapError(error, "Failed to push snapshot to GitHub");
    }
  }

  async ping(): Promise<void> {
    try {
      const response = await this.apiRequest(
        "GET",
        `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}`,
      );

      if (!response.ok) {
        if (response.status === 401) {
          throw new AuthenticationError("Invalid GitHub token");
        }
        if (response.status === 404) {
          throw new RemoteConfigurationError(
            `Repository ${this.githubOptions.owner}/${this.githubOptions.repo} not found`,
          );
        }
        throw new NetworkError(`GitHub API returned ${response.status}`);
      }
    } catch (error) {
      if (error instanceof RemoteDatabaseError) {
        throw error;
      }
      throw this.wrapError(error, "GitHub API health check failed");
    }
  }

  private async getHeadCommitSha(): Promise<string> {
    const response = await this.apiRequest(
      "GET",
      `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/git/ref/heads/${this.githubOptions.branch}`,
    );

    if (!response.ok) {
      throw new NetworkError(`Failed to get head commit: ${response.status}`);
    }

    const ref = (await response.json()) as { object: { sha: string } };
    return ref.object.sha;
  }

  private async fetchSchemas(): Promise<Record<string, unknown>[]> {
    try {
      const schemas: Record<string, unknown>[] = [];
      const response = await this.apiRequest(
        "GET",
        `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/contents/${this.githubOptions.schemasDir}?ref=${this.githubOptions.branch}`,
      );

      if (!response.ok) {
        // If schemas directory doesn't exist, return empty array
        if (response.status === 404) {
          return schemas;
        }
        throw new NetworkError(`Failed to fetch schemas: ${response.status}`);
      }

      const files = (await response.json()) as Array<{
        name: string;
        type: string;
      }>;

      for (const file of files) {
        if (file.type === "file" && file.name.endsWith(".json")) {
          const fileResponse = await this.apiRequest(
            "GET",
            `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/contents/${this.githubOptions.schemasDir}/${file.name}?ref=${this.githubOptions.branch}`,
          );

          if (fileResponse.ok) {
            const fileContent = (await fileResponse.json()) as {
              content: string;
            };
            const content = atob(fileContent.content);
            const schema = JSON.parse(content);
            schemas.push(schema);
          }
        }
      }

      return schemas;
    } catch (error) {
      this.logError("Error fetching schemas", error);
      throw error;
    }
  }

  private async fetchRecords(): Promise<Record<string, unknown>[]> {
    try {
      const records: Record<string, unknown>[] = [];
      const response = await this.apiRequest(
        "GET",
        `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/contents/${this.githubOptions.contentDir}?ref=${this.githubOptions.branch}`,
      );

      if (!response.ok) {
        // If content directory doesn't exist, return empty array
        if (response.status === 404) {
          return records;
        }
        throw new NetworkError(`Failed to fetch records: ${response.status}`);
      }

      const items = (await response.json()) as Array<{
        name: string;
        type: string;
        path: string;
      }>;

      // Recursively fetch all JSON files
      for (const item of items) {
        if (item.type === "dir") {
          const dirRecords = await this.fetchRecordsFromDirectory(item.path);
          records.push(...dirRecords);
        } else if (item.type === "file" && item.name.endsWith(".json")) {
          const fileResponse = await this.apiRequest(
            "GET",
            `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/contents/${item.path}?ref=${this.githubOptions.branch}`,
          );

          if (fileResponse.ok) {
            const fileContent = (await fileResponse.json()) as {
              content: string;
            };
            const content = atob(fileContent.content);
            const record = JSON.parse(content);
            records.push(record);
          }
        }
      }

      return records;
    } catch (error) {
      this.logError("Error fetching records", error);
      throw error;
    }
  }

  private async fetchRecordsFromDirectory(
    path: string,
  ): Promise<Record<string, unknown>[]> {
    const records: Record<string, unknown>[] = [];
    const response = await this.apiRequest(
      "GET",
      `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/contents/${path}?ref=${this.githubOptions.branch}`,
    );

    if (!response.ok) {
      return records;
    }

    const items = (await response.json()) as Array<{
      name: string;
      type: string;
      path: string;
    }>;

    for (const item of items) {
      if (item.type === "file" && item.name.endsWith(".json")) {
        const fileResponse = await this.apiRequest(
          "GET",
          `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/contents/${item.path}?ref=${this.githubOptions.branch}`,
        );

        if (fileResponse.ok) {
          const fileContent = (await fileResponse.json()) as {
            content: string;
          };
          const content = atob(fileContent.content);
          const record = JSON.parse(content);
          records.push(record);
        }
      }
    }

    return records;
  }

  private async createTreeItems(
    snapshot: Omit<RemoteSnapshot, "commitId">,
  ): Promise<
    Array<{ path: string; mode: "100644"; type: "blob"; content: string }>
  > {
    const treeItems: Array<{
      path: string;
      mode: "100644";
      type: "blob";
      content: string;
    }> = [];

    // Add schema files
    for (const schema of snapshot.schemas) {
      treeItems.push({
        path: `${this.githubOptions.schemasDir}/${schema.name}.json`,
        mode: "100644",
        type: "blob",
        content: JSON.stringify(schema, null, 2),
      });
    }

    // Add record files
    for (const record of snapshot.records) {
      treeItems.push({
        path: `${this.githubOptions.contentDir}/${record.schema}/${record.id}.json`,
        mode: "100644",
        type: "blob",
        content: JSON.stringify(record, null, 2),
      });
    }

    return treeItems;
  }

  private async createGitTree(
    treeItems: Array<{
      path: string;
      mode: "100644";
      type: "blob";
      content: string;
    }>,
    baseTree: string,
  ): Promise<{ sha: string }> {
    const response = await this.apiRequest(
      "POST",
      `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/git/trees`,
      {
        base_tree: baseTree,
        tree: treeItems,
      },
    );

    if (!response.ok) {
      throw new NetworkError(`Failed to create git tree: ${response.status}`);
    }

    return (await response.json()) as { sha: string };
  }

  private async createCommit(
    message: string,
    tree: string,
    parents: string[],
  ): Promise<{ sha: string }> {
    const response = await this.apiRequest(
      "POST",
      `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/git/commits`,
      {
        message,
        tree,
        parents,
      },
    );

    if (!response.ok) {
      throw new NetworkError(`Failed to create commit: ${response.status}`);
    }

    return (await response.json()) as { sha: string };
  }

  private async updateReference(branch: string, sha: string): Promise<void> {
    const response = await this.apiRequest(
      "PATCH",
      `/repos/${this.githubOptions.owner}/${this.githubOptions.repo}/git/refs/heads/${branch}`,
      {
        sha,
      },
    );

    if (!response.ok) {
      throw new NetworkError(`Failed to update reference: ${response.status}`);
    }
  }

  private async apiRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${this.apiBaseUrl}${path}`;
    const headers: HeadersInit = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "static-db",
      Authorization: `token ${this.githubOptions.token}`,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}
