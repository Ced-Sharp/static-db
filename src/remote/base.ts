import {
  NetworkError,
  OutOfDateError,
  RemoteDatabaseError,
} from "../core/errors.js";
import type {
  RemoteDatabase,
  RemoteDatabaseInitOptions,
} from "../core/interfaces.js";
import type { RemoteSnapshot } from "../core/types.js";

/**
 * Abstract base class for RemoteDatabase implementations.
 * Provides common utilities and error handling patterns.
 */
export abstract class BaseRemoteDatabase implements RemoteDatabase {
  protected readonly options: RemoteDatabaseInitOptions;
  protected isInitialized = false;

  constructor(options: RemoteDatabaseInitOptions = {}) {
    this.options = { ...options };
  }

  /**
   * Initialize the remote database connection.
   * Child classes should override this method to perform implementation-specific setup.
   */
  async init(options?: RemoteDatabaseInitOptions): Promise<void> {
    if (this.isInitialized && !options) {
      return; // Already initialized
    }

    try {
      await this.doInit({ ...this.options, ...options });
      this.isInitialized = true;
    } catch (error) {
      throw this.wrapError(error, "Failed to initialize remote database");
    }
  }

  /**
   * Abstract method for implementation-specific initialization.
   */
  protected abstract doInit(options: RemoteDatabaseInitOptions): Promise<void>;

  /**
   * Fetch snapshot from remote.
   * Child classes should implement the actual fetching logic.
   */
  abstract fetchSnapshot(): Promise<RemoteSnapshot>;

  /**
   * Push snapshot to remote.
   * Child classes should implement the actual pushing logic.
   */
  abstract pushSnapshot(
    baseCommitId: string,
    newSnapshot: Omit<RemoteSnapshot, "commitId">,
  ): Promise<{ newCommitId: string }>;

  /**
   * Health check implementation.
   * Default implementation just calls fetchSnapshot to ensure connectivity.
   */
  async ping?(): Promise<void> {
    try {
      await this.fetchSnapshot();
    } catch (error) {
      throw this.wrapError(error, "Health check failed");
    }
  }

  /**
   * Cleanup implementation.
   * Child classes can override for specific cleanup needs.
   */
  async destroy?(): Promise<void> {
    this.isInitialized = false;
  }

  /**
   * Ensure the database is initialized before operations.
   */
  protected async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }
  }

  /**
   * Wrap errors in appropriate RemoteDatabaseError types.
   */
  protected wrapError(error: unknown, context: string): RemoteDatabaseError {
    if (error instanceof RemoteDatabaseError) {
      return error;
    }

    if (error instanceof Error) {
      // Check for common error patterns
      const message = error.message.toLowerCase();

      if (
        message.includes("network") ||
        message.includes("fetch") ||
        message.includes("timeout")
      ) {
        return new NetworkError(`${context}: ${error.message}`, error);
      }

      if (
        message.includes("unauthorized") ||
        message.includes("forbidden") ||
        message.includes("auth")
      ) {
        return new NetworkError(
          `${context}: Authentication failed - ${error.message}`,
          error,
        );
      }

      if (message.includes("not found") || message.includes("404")) {
        return new RemoteDatabaseError(
          `${context}: Resource not found - ${error.message}`,
          "NOT_FOUND",
          error,
          this.options.endpointId,
        );
      }
    }

    return new RemoteDatabaseError(
      `${context}: ${error instanceof Error ? error.message : String(error)}`,
      "UNKNOWN_ERROR",
      error instanceof Error ? error : undefined,
      this.options.endpointId,
    );
  }

  /**
   * Validate snapshot before pushing.
   */
  protected validateSnapshot(snapshot: Omit<RemoteSnapshot, "commitId">): void {
    if (!snapshot.schemas || !Array.isArray(snapshot.schemas)) {
      throw new RemoteDatabaseError(
        "Invalid snapshot: schemas must be an array",
        "VALIDATION_ERROR",
        undefined,
        this.options.endpointId,
      );
    }

    if (!snapshot.records || !Array.isArray(snapshot.records)) {
      throw new RemoteDatabaseError(
        "Invalid snapshot: records must be an array",
        "VALIDATION_ERROR",
        undefined,
        this.options.endpointId,
      );
    }

    // Validate schemas
    for (const schema of snapshot.schemas) {
      if (!schema.name || typeof schema.name !== "string") {
        throw new RemoteDatabaseError(
          "Invalid schema: name is required and must be a string",
          "VALIDATION_ERROR",
          undefined,
          this.options.endpointId,
        );
      }

      if (!schema.fields || !Array.isArray(schema.fields)) {
        throw new RemoteDatabaseError(
          "Invalid schema: fields must be an array",
          "VALIDATION_ERROR",
          undefined,
          this.options.endpointId,
        );
      }
    }

    // Validate records
    for (const record of snapshot.records) {
      if (!record.id || typeof record.id !== "string") {
        throw new RemoteDatabaseError(
          "Invalid record: id is required and must be a string",
          "VALIDATION_ERROR",
          undefined,
          this.options.endpointId,
        );
      }

      if (!record.schema || typeof record.schema !== "string") {
        throw new RemoteDatabaseError(
          "Invalid record: schema is required and must be a string",
          "VALIDATION_ERROR",
          undefined,
          this.options.endpointId,
        );
      }

      if (!record.data || typeof record.data !== "object") {
        throw new RemoteDatabaseError(
          "Invalid record: data is required and must be an object",
          "VALIDATION_ERROR",
          undefined,
          this.options.endpointId,
        );
      }
    }
  }

  /**
   * Check if commit IDs match, handling undefined/null cases.
   */
  protected commitIdsMatch(
    id1: string | undefined,
    id2: string | undefined,
  ): boolean {
    if (!id1 || !id2) return false;
    return id1 === id2;
  }

  /**
   * Create an OutOfDateError with appropriate context.
   */
  protected createOutOfDateError(
    baseCommitId: string,
    actualCommitId: string,
  ): OutOfDateError {
    return new OutOfDateError(
      `Remote advanced from ${baseCommitId} to ${actualCommitId}`,
      baseCommitId,
      actualCommitId,
    );
  }

  /**
   * Log debug information (can be overridden for specific logging implementations).
   */
  protected log(message: string, data?: unknown): void {
    if (this.options.label) {
      console.log(`[${this.options.label}] ${message}`, data);
    } else {
      console.log(message, data);
    }
  }

  /**
   * Log error information.
   */
  protected logError(message: string, error: unknown): void {
    if (this.options.label) {
      console.error(`[${this.options.label}] ${message}`, error);
    } else {
      console.error(message, error);
    }
  }
}
