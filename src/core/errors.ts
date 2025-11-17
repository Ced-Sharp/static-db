/**
 * Custom error types for the Static DB CMS data layer.
 * Provides clear error categorization for different failure modes.
 */

/**
 * Base class for all Static DB errors.
 */
export abstract class StaticDBError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get a user-friendly error message.
   */
  getUserMessage(): string {
    return this.message;
  }

  /**
   * Check if this error should be retried.
   */
  isRetryable(): boolean {
    return false;
  }
}

/**
 * Base class for RemoteDatabase related errors.
 */
export abstract class RemoteDatabaseError extends StaticDBError {
  constructor(
    message: string,
    code: string,
    cause?: Error,
    public readonly endpointId?: string,
  ) {
    super(message, code, cause);
  }
}

/**
 * Error thrown when remote has advanced since the provided base commit ID.
 * This indicates that the local changes are out of date and should be discarded.
 */
export class OutOfDateError extends RemoteDatabaseError {
  constructor(
    message: string = "Remote has advanced since base commit ID",
    public readonly baseCommitId?: string,
    public readonly actualCommitId?: string,
  ) {
    super(message, "OUT_OF_DATE");
  }

  override getUserMessage(): string {
    return "The remote data has been updated by another process. Your local changes will be discarded.";
  }

  override isRetryable(): boolean {
    return true; // Can retry after resetting local state
  }
}

/**
 * Authentication or authorization failure with remote backend.
 */
export class AuthenticationError extends RemoteDatabaseError {
  constructor(message: string = "Authentication failed", public readonly endpoint?: string) {
    super(message, "AUTHENTICATION_FAILED");
  }

  override getUserMessage(): string {
    return "Authentication with the remote backend failed. Please check your credentials.";
  }

  override isRetryable(): boolean {
    return false; // Requires new credentials
  }
}

/**
 * Network connectivity or API availability issues.
 */
export class NetworkError extends RemoteDatabaseError {
  constructor(message: string = "Network error occurred", cause?: Error) {
    super(message, "NETWORK_ERROR", cause);
  }

  override getUserMessage(): string {
    return "Network connectivity issues occurred. Please check your connection and try again.";
  }

  override isRetryable(): boolean {
    return true;
  }
}

/**
 * Configuration or setup errors for RemoteDatabase.
 */
export class RemoteConfigurationError extends RemoteDatabaseError {
  constructor(message: string = "Remote database configuration error") {
    super(message, "REMOTE_CONFIGURATION_ERROR");
  }

  override getUserMessage(): string {
    return "The remote database is not configured correctly.";
  }

  override isRetryable(): boolean {
    return false;
  }
}

/**
 * Base class for LocalDatabase related errors.
 */
export abstract class LocalDatabaseError extends StaticDBError {
  constructor(message: string, code: string, cause?: Error) {
    super(message, code, cause);
  }
}

/**
 * Quota exceeded or storage full error.
 */
export class QuotaExceededError extends LocalDatabaseError {
  constructor(message: string = "Storage quota exceeded", cause?: Error) {
    super(message, "QUOTA_EXCEEDED", cause);
  }

  override getUserMessage(): string {
    return "Local storage is full. Please clear some data or free up space.";
  }

  override isRetryable(): boolean {
    return false; // Requires user action
  }
}

/**
 * IndexedDB not available or corrupted.
 */
export class StorageUnavailableError extends LocalDatabaseError {
  constructor(message: string = "Local storage unavailable", cause?: Error) {
    super(message, "STORAGE_UNAVAILABLE", cause);
  }

  override getUserMessage(): string {
    return "Local storage is not available in this browser or environment.";
  }

  override isRetryable(): boolean {
    return false;
  }
}

/**
 * Data corruption or validation errors in local storage.
 */
export class DataCorruptionError extends LocalDatabaseError {
  constructor(message: string = "Local data corruption detected", cause?: Error) {
    super(message, "DATA_CORRUPTION", cause);
  }

  override getUserMessage(): string {
    return "Local data appears to be corrupted. The application will reset local storage.";
  }

  override isRetryable(): boolean {
    return true; // Can retry after clearing local data
  }
}

/**
 * Base class for SyncService related errors.
 */
export abstract class SyncError extends StaticDBError {
  constructor(
    message: string,
    code: string,
    cause?: Error,
    public readonly syncPhase?: string,
  ) {
    super(message, code, cause);
  }
}

/**
 * Sync failed due to unrecoverable error.
 */
export class SyncFailedError extends SyncError {
  constructor(message: string = "Sync operation failed", cause?: Error, phase?: string) {
    super(message, "SYNC_FAILED", cause, phase);
  }

  override getUserMessage(): string {
    return "Synchronization failed. Please try again later.";
  }

  override isRetryable(): boolean {
    return true;
  }
}

/**
 * Data validation errors.
 */
export class ValidationError extends StaticDBError {
  constructor(
    message: string = "Data validation failed",
    public readonly field?: string,
    public readonly value?: unknown,
    public readonly schema?: string,
  ) {
    super(message, "VALIDATION_ERROR");
  }

  override getUserMessage(): string {
    if (this.field) {
      return `Invalid data in field '${this.field}': ${this.message}`;
    }
    return `Data validation failed: ${this.message}`;
  }

  override isRetryable(): boolean {
    return false; // Requires data correction
  }
}

/**
 * Schema validation errors.
 */
export class SchemaValidationError extends ValidationError {
  constructor(
    message: string = "Schema validation failed",
    public readonly schemaName?: string,
  ) {
    super(message);
  }

  override getUserMessage(): string {
    if (this.schemaName) {
      return `Schema '${this.schemaName}' validation failed: ${this.message}`;
    }
    return `Schema validation failed: ${this.message}`;
  }
}

/**
 * Utility function to check if an error is a specific type.
 */
export function isErrorOfType<T extends StaticDBError>(
  error: unknown,
  errorClass: new (...args: any[]) => T,
): error is T {
  return error instanceof errorClass;
}

/**
 * Utility function to check if an error is retryable.
 */
export function isRetryableError(error: unknown): boolean {
  return error instanceof StaticDBError && error.isRetryable();
}

/**
 * Utility function to get a user-friendly message from any error.
 */
export function getUserErrorMessage(error: unknown): string {
  if (error instanceof StaticDBError) {
    return error.getUserMessage();
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred";
}

/**
 * Utility function to wrap unknown errors in a StaticDBError.
 */
export function wrapError(error: unknown, message: string = "Unknown error occurred"): StaticDBError {
  if (error instanceof StaticDBError) {
    return error;
  }

  if (error instanceof Error) {
    return new SyncError(`${message}: ${error.message}`, "UNKNOWN_ERROR", error);
  }

  return new SyncError(message, "UNKNOWN_ERROR");
}