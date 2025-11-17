import { describe, expect, it } from "vitest";

import {
  StaticDBError,
  RemoteDatabaseError,
  OutOfDateError,
  AuthenticationError,
  NetworkError,
  RemoteConfigurationError,
  LocalDatabaseError,
  QuotaExceededError,
  StorageUnavailableError,
  DataCorruptionError,
  SyncError,
  SyncFailedError,
  ValidationError,
  SchemaValidationError,
  isErrorOfType,
  isRetryableError,
  getUserErrorMessage,
  wrapError,
} from "../../src/core/errors";

describe("Error Classes", () => {
  describe("StaticDBError", () => {
    it("creates error with proper structure", () => {
      const error = new StaticDBError("Test message", "TEST_CODE");
      expect(error.message).toBe("Test message");
      expect(error.code).toBe("TEST_CODE");
      expect(error.name).toBe("StaticDBError");
      expect(error.getUserMessage()).toBe("Test message");
      expect(error.isRetryable()).toBe(false);
    });

    it("includes cause when provided", () => {
      const cause = new Error("Original error");
      const error = new StaticDBError("Wrapped error", "WRAP", cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe("RemoteDatabaseError", () => {
    it("creates remote database error", () => {
      const error = new RemoteDatabaseError("Remote error", "REMOTE_ERROR", undefined, "test-endpoint");
      expect(error.endpointId).toBe("test-endpoint");
      expect(error.code).toBe("REMOTE_ERROR");
    });
  });

  describe("OutOfDateError", () => {
    it("creates out of date error", () => {
      const error = new OutOfDateError("Out of date", "abc123", "def456");
      expect(error.baseCommitId).toBe("abc123");
      expect(error.actualCommitId).toBe("def456");
      expect(error.isRetryable()).toBe(true);
      expect(error.getUserMessage()).toContain("updated by another process");
    });
  });

  describe("AuthenticationError", () => {
    it("creates authentication error", () => {
      const error = new AuthenticationError("Auth failed", "https://api.example.com");
      expect(error.endpoint).toBe("https://api.example.com");
      expect(error.isRetryable()).toBe(false);
      expect(error.getUserMessage()).toContain("check your credentials");
    });
  });

  describe("NetworkError", () => {
    it("creates network error", () => {
      const cause = new Error("Connection timeout");
      const error = new NetworkError("Network issue", cause);
      expect(error.cause).toBe(cause);
      expect(error.isRetryable()).toBe(true);
      expect(error.getUserMessage()).toContain("check your connection");
    });
  });

  describe("QuotaExceededError", () => {
    it("creates quota exceeded error", () => {
      const error = new QuotaExceededError("Storage full");
      expect(error.isRetryable()).toBe(false);
      expect(error.getUserMessage()).toContain("clear some data");
    });
  });

  describe("DataCorruptionError", () => {
    it("creates data corruption error", () => {
      const error = new DataCorruptionError("Invalid data");
      expect(error.isRetryable()).toBe(true);
      expect(error.getUserMessage()).toContain("reset local storage");
    });
  });

  describe("SyncError", () => {
    it("creates sync error with phase", () => {
      const error = new SyncError("Sync failed", "SYNC_FAILED", undefined, "push");
      expect(error.syncPhase).toBe("push");
      expect(error.isRetryable()).toBe(true);
    });
  });

  describe("ValidationError", () => {
    it("creates validation error with context", () => {
      const error = new ValidationError("Invalid field", "title", "invalid-value", "product");
      expect(error.field).toBe("title");
      expect(error.value).toBe("invalid-value");
      expect(error.schema).toBe("product");
      expect(error.getUserMessage()).toContain("field 'title'");
    });
  });

  describe("SchemaValidationError", () => {
    it("creates schema validation error", () => {
      const error = new SchemaValidationError("Invalid schema", "product");
      expect(error.schemaName).toBe("product");
      expect(error.getUserMessage()).toContain("Schema 'product'");
    });
  });
});

describe("Error Utilities", () => {
  describe("isErrorOfType", () => {
    it("correctly identifies error types", () => {
      const outOfDateError = new OutOfDateError();
      const networkError = new NetworkError();
      const validationError = new ValidationError();

      expect(isErrorOfType(outOfDateError, OutOfDateError)).toBe(true);
      expect(isErrorOfType(networkError, NetworkError)).toBe(true);
      expect(isErrorOfType(validationError, ValidationError)).toBe(true);

      expect(isErrorOfType(outOfDateError, NetworkError)).toBe(false);
      expect(isErrorOfType(networkError, OutOfDateError)).toBe(false);
      expect(isErrorOfType(new Error("generic"), ValidationError)).toBe(false);
    });
  });

  describe("isRetryableError", () => {
    it("identifies retryable errors", () => {
      expect(isRetryableError(new OutOfDateError())).toBe(true);
      expect(isRetryableError(new NetworkError())).toBe(true);
      expect(isRetryableError(new SyncFailedError())).toBe(true);
      expect(isRetryableError(new DataCorruptionError())).toBe(true);
    });

    it("identifies non-retryable errors", () => {
      expect(isRetryableError(new AuthenticationError())).toBe(false);
      expect(isRetryableError(new QuotaExceededError())).toBe(false);
      expect(isRetryableError(new ValidationError())).toBe(false);
      expect(isRetryableError(new RemoteConfigurationError())).toBe(false);
    });

    it("handles non-StaticDB errors", () => {
      expect(isRetryableError(new Error("generic"))).toBe(false);
      expect(isRetryableError("string error")).toBe(false);
      expect(isRetryableError(null)).toBe(false);
    });
  });

  describe("getUserErrorMessage", () => {
    it("returns user-friendly message for StaticDB errors", () => {
      const authError = new AuthenticationError();
      expect(getUserErrorMessage(authError)).toContain("Authentication");

      const validationError = new ValidationError("Invalid value", "field");
      expect(getUserErrorMessage(validationError)).toContain("field 'field'");
    });

    it("falls back to error message for regular errors", () => {
      const error = new Error("Something went wrong");
      expect(getUserErrorMessage(error)).toBe("Something went wrong");
    });

    it("handles non-error objects", () => {
      expect(getUserErrorMessage("string error")).toBe("An unknown error occurred");
      expect(getUserErrorMessage(null)).toBe("An unknown error occurred");
      expect(getUserErrorMessage(123)).toBe("An unknown error occurred");
    });
  });

  describe("wrapError", () => {
    it("wraps unknown errors in StaticDBError", () => {
      const wrapped = wrapError("string error", "Context message");
      expect(wrapped).toBeInstanceOf(SyncError);
      expect(wrapped.message).toBe("Context message: string error");
    });

    it("preserves StaticDB errors", () => {
      const original = new OutOfDateError();
      const wrapped = wrapError(original, "Context");
      expect(wrapped).toBe(original); // Same instance
    });

    it("wraps regular Error instances", () => {
      const original = new Error("Original message");
      const wrapped = wrapError(original, "Context");
      expect(wrapped).toBeInstanceOf(SyncError);
      expect(wrapped.message).toBe("Context: Original message");
      expect(wrapped.cause).toBe(original);
    });
  });

  describe("Error Inheritance", () => {
    it("maintains proper prototype chain", () => {
      const outOfDateError = new OutOfDateError();
      expect(outOfDateError).toBeInstanceOf(OutOfDateError);
      expect(outOfDateError).toBeInstanceOf(RemoteDatabaseError);
      expect(outOfDateError).toBeInstanceOf(StaticDBError);
      expect(outOfDateError).toBeInstanceOf(Error);

      const localError = new QuotaExceededError();
      expect(localError).toBeInstanceOf(QuotaExceededError);
      expect(localError).toBeInstanceOf(LocalDatabaseError);
      expect(localError).toBeInstanceOf(StaticDBError);
      expect(localError).toBeInstanceOf(Error);
    });
  });

  describe("Error Serialization", () => {
    it("can be serialized and deserialized", () => {
      const original = new OutOfDateError("Test error", "abc123", "def456");
      const serialized = JSON.stringify({
        message: original.message,
        code: original.code,
        baseCommitId: original.baseCommitId,
        actualCommitId: original.actualCommitId,
      });
      const parsed = JSON.parse(serialized);

      expect(parsed.message).toBe("Test error");
      expect(parsed.code).toBe("OUT_OF_DATE");
      expect(parsed.baseCommitId).toBe("abc123");
      expect(parsed.actualCommitId).toBe("def456");
    });
  });
});