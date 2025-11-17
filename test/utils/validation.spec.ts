import { describe, expect, it, beforeEach } from "vitest";

import {
  CMSValidator,
  createValidator,
  validateRecordWithSchemas,
  validateSnapshot,
  ValidationResult,
} from "../../src/utils/validation";
import { SchemaDef, EntityRecord, FIELD_TYPES } from "../../src/core/types";
import { ValidationError, SchemaValidationError } from "../../src/core/errors";

describe("CMSValidator", () => {
  let validator: CMSValidator;

  beforeEach(() => {
    validator = createValidator();
  });

  describe("Schema Registration", () => {
    it("registers valid schemas", () => {
      const schema: SchemaDef = {
        name: "product",
        fields: [
          { name: "title", type: "string", required: true },
          { name: "price", type: "number", required: true },
        ],
      };

      expect(() => validator.registerSchema(schema)).not.toThrow();
      expect(validator.getSchema("product")).toEqual(schema);
    });

    it("rejects invalid schemas", () => {
      const invalidSchema = {
        name: "",
        fields: "not-an-array",
      } as any;

      expect(() => validator.registerSchema(invalidSchema)).toThrow(SchemaValidationError);
    });

    it("registers multiple schemas", () => {
      const schemas: SchemaDef[] = [
        {
          name: "product",
          fields: [{ name: "title", type: "string", required: true }],
        },
        {
          name: "category",
          fields: [{ name: "name", type: "string", required: true }],
        },
      ];

      validator.registerSchemas(schemas);

      expect(validator.getAllSchemas()).toHaveLength(2);
      expect(validator.getSchema("product")).toBeDefined();
      expect(validator.getSchema("category")).toBeDefined();
    });

    it("clears schemas", () => {
      validator.registerSchema({
        name: "test",
        fields: [],
      });

      expect(validator.getAllSchemas()).toHaveLength(1);

      validator.clearSchemas();

      expect(validator.getAllSchemas()).toHaveLength(0);
      expect(validator.getSchema("test")).toBeUndefined();
    });
  });

  describe("Schema Validation", () => {
    it("validates schema structure", () => {
      const schema: SchemaDef = {
        name: "user",
        label: "User",
        description: "User schema",
        fields: [
          {
            name: "name",
            type: "string",
            required: true,
            label: "Full Name",
          },
          {
            name: "age",
            type: "number",
            constraints: { min: 0, max: 150 },
          },
          {
            name: "email",
            type: "string",
            constraints: { pattern: "^[^@]+@[^@]+\\.[^@]+$" },
          },
        ],
      };

      const result = validator.validateSchema(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects duplicate field names", () => {
      const schema = {
        name: "test",
        fields: [
          { name: "title", type: "string" },
          { name: "title", type: "number" },
        ],
      } as SchemaDef;

      const result = validator.validateSchema(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2); // One for each duplicate
      expect(result.errors[0].message).toContain("Duplicate field name 'title'");
    });

    it("validates field names format", () => {
      const schema = {
        name: "test",
        fields: [
          { name: "valid-field", type: "string" },
          { name: "123invalid", type: "string" },
          { name: "invalid space", type: "string" },
          { name: "_system", type: "string" },
        ],
      } as SchemaDef;

      const result = validator.validateSchema(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.message.includes("123invalid"))).toBe(true);
      expect(result.errors.some(e => e.message.includes("invalid space"))).toBe(true);
      expect(result.warnings.some(w => w.includes("_system"))).toBe(true);
    });

    it("validates relation field references", () => {
      const schema = {
        name: "product",
        fields: [
          { name: "title", type: "string" },
          { name: "category", type: "relation", relationSchema: "nonexistent" },
        ],
      } as SchemaDef;

      const result = validator.validateSchema(schema);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("unknown schema 'nonexistent'");
    });

    it("validates media field accepted types", () => {
      const schema = {
        name: "test",
        fields: [
          { name: "image", type: "media", acceptedTypes: "not-an-array" },
        ],
      } as SchemaDef;

      const result = validator.validateSchema(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain("acceptedTypes must be an array");
    });

    it("warns about required fields with defaults", () => {
      const schema = {
        name: "test",
        fields: [
          { name: "title", type: "string", required: true, defaultValue: "Default Title" },
        ],
      } as SchemaDef;

      const result = validator.validateSchema(schema);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Required field 'title' has default value");
    });
  });

  describe("Field Validation", () => {
    it("validates string fields", () => {
      const field = { name: "title", type: "string", required: true };
      const result = validator.validateField(field);

      expect(result.isValid).toBe(true);
    });

    it("validates number fields", () => {
      const field = { name: "price", type: "number", required: true };
      const result = validator.validateField(field);

      expect(result.isValid).toBe(true);
    });

    it("validates boolean fields", () => {
      const field = { name: "published", type: "boolean" };
      const result = validator.validateField(field);

      expect(result.isValid).toBe(true);
    });

    it("validates date fields", () => {
      const field = { name: "createdAt", type: "date", required: true };
      const result = validator.validateField(field);

      expect(result.isValid).toBe(true);
    });

    it("validates relation fields", () => {
      // First register a schema for the relation
      validator.registerSchema({
        name: "category",
        fields: [{ name: "name", type: "string" }],
      });

      const field = { name: "category", type: "relation", relationSchema: "category" };
      const result = validator.validateField(field);

      expect(result.isValid).toBe(true);
    });

    it("validates media fields", () => {
      const field = { name: "image", type: "media", acceptedTypes: ["image/*", "video/*"] };
      const result = validator.validateField(field);

      expect(result.isValid).toBe(true);
    });

    it("warns about unknown field types", () => {
      const field = { name: "custom", type: "unknown-type" } as any;
      const result = validator.validateField(field);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Unknown field type 'unknown-type'");
    });
  });

  describe("Record Validation", () => {
    beforeEach(() => {
      validator.registerSchema({
        name: "product",
        fields: [
          { name: "title", type: "string", required: true },
          { name: "price", type: "number", required: true },
          { name: "description", type: "string", required: false },
          { name: "inStock", type: "boolean", required: false },
          { name: "createdAt", type: "date", required: true },
          { name: "category", type: "relation", relationSchema: "category" },
        ],
      });

      validator.registerSchema({
        name: "category",
        fields: [{ name: "name", type: "string", required: true }],
      });
    });

    it("validates complete record", () => {
      const record: EntityRecord = {
        id: "prod-1",
        schema: "product",
        data: {
          title: "Test Product",
          price: 29.99,
          description: "A test product",
          inStock: true,
          createdAt: "2023-01-01T00:00:00.000Z",
          category: "cat-1",
        },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validator.validateRecord(record);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects missing required fields", () => {
      const record: EntityRecord = {
        id: "prod-1",
        schema: "product",
        data: {
          title: "Test Product",
          // missing price and createdAt
        },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validator.validateRecord(record);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some(e => e.field === "price")).toBe(true);
      expect(result.errors.some(e => e.field === "createdAt")).toBe(true);
    });

    it("detects invalid field values", () => {
      const record: EntityRecord = {
        id: "prod-1",
        schema: "product",
        data: {
          title: 123, // Should be string
          price: "not-a-number", // Should be number
          createdAt: "invalid-date", // Should be ISO date
          category: ["cat-1", "cat-2"], // Valid array of relations
        },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validator.validateRecord(record);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "title")).toBe(true);
      expect(result.errors.some(e => e.field === "price")).toBe(true);
      expect(result.errors.some(e => e.field === "createdAt")).toBe(true);
    });

    it("detects unknown fields", () => {
      const record: EntityRecord = {
        id: "prod-1",
        schema: "product",
        data: {
          title: "Test Product",
          price: 29.99,
          createdAt: "2023-01-01T00:00:00.000Z",
          unknownField: "should not be here",
          anotherUnknown: 123,
        },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validator.validateRecord(record);

      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toContain("unknownField");
      expect(result.warnings[1]).toContain("anotherUnknown");
    });

    it("validates timestamps", () => {
      const record: EntityRecord = {
        id: "prod-1",
        schema: "product",
        data: {
          title: "Test Product",
          price: 29.99,
          createdAt: "2023-01-01T00:00:00.000Z",
        },
        createdAt: "invalid-date", // Invalid
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validator.validateRecord(record);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "createdAt")).toBe(true);
    });

    it("detects invalid timestamp order", () => {
      const record: EntityRecord = {
        id: "prod-1",
        schema: "product",
        data: {
          title: "Test Product",
          price: 29.99,
          createdAt: "2023-01-01T00:00:00.000Z",
        },
        createdAt: "2023-01-02T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z", // Before createdAt
      };

      const result = validator.validateRecord(record);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("updatedAt timestamp is before createdAt");
    });

    it("handles unknown schema", () => {
      const record: EntityRecord = {
        id: "test-1",
        schema: "unknown-schema",
        data: { title: "Test" },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validator.validateRecord(record);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].field).toBe("schema");
      expect(result.errors[0].message).toContain("Unknown schema 'unknown-schema'");
    });
  });

  describe("Field Value Validation", () => {
    it("validates constraints", () => {
      validator.registerSchema({
        name: "user",
        fields: [
          {
            name: "age",
            type: "number",
            constraints: { min: 0, max: 150 },
          },
          {
            name: "email",
            type: "string",
            constraints: { pattern: "^[^@]+@[^@]+\\.[^@]+$" },
          },
          {
            name: "status",
            type: "string",
            constraints: { enum: ["active", "inactive", "pending"] },
          },
          {
            name: "name",
            type: "string",
            constraints: { min: 2, max: 50 },
          },
        ],
      });

      const record: EntityRecord = {
        id: "user-1",
        schema: "user",
        data: {
          age: -5, // Below min
          email: "invalid-email", // Invalid pattern
          status: "unknown", // Not in enum
          name: "A", // Too short
        },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validator.validateRecord(record);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(4);
    });

    it("passes valid constraint values", () => {
      validator.registerSchema({
        name: "user",
        fields: [
          {
            name: "age",
            type: "number",
            constraints: { min: 0, max: 150 },
          },
          {
            name: "email",
            type: "string",
            constraints: { pattern: "^[^@]+@[^@]+\\.[^@]+$" },
          },
          {
            name: "status",
            type: "string",
            constraints: { enum: ["active", "inactive", "pending"] },
          },
        ],
      });

      const record: EntityRecord = {
        id: "user-1",
        schema: "user",
        data: {
          age: 25,
          email: "test@example.com",
          status: "active",
        },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validator.validateRecord(record);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

describe("Utility Functions", () => {
  describe("createValidator", () => {
    it("creates a new validator instance", () => {
      const validator = createValidator();
      expect(validator).toBeInstanceOf(CMSValidator);
    });

    it("creates independent instances", () => {
      const validator1 = createValidator();
      const validator2 = createValidator();

      validator1.registerSchema({
        name: "test",
        fields: [],
      });

      expect(validator1.getAllSchemas()).toHaveLength(1);
      expect(validator2.getAllSchemas()).toHaveLength(0);
    });
  });

  describe("validateRecordWithSchemas", () => {
    it("validates record with provided schemas", () => {
      const schemas: SchemaDef[] = [
        {
          name: "product",
          fields: [{ name: "title", type: "string", required: true }],
        },
      ];

      const record: EntityRecord = {
        id: "prod-1",
        schema: "product",
        data: { title: "Test Product" },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validateRecordWithSchemas(record, schemas);

      expect(result.isValid).toBe(true);
    });

    it("fails validation for invalid record", () => {
      const schemas: SchemaDef[] = [
        {
          name: "product",
          fields: [{ name: "title", type: "string", required: true }],
        },
      ];

      const record: EntityRecord = {
        id: "prod-1",
        schema: "product",
        data: {}, // Missing required title
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = validateRecordWithSchemas(record, schemas);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe("validateSnapshot", () => {
    it("validates complete snapshot", () => {
      const schemas: SchemaDef[] = [
        {
          name: "product",
          fields: [{ name: "title", type: "string", required: true }],
        },
      ];

      const records: EntityRecord[] = [
        {
          id: "prod-1",
          schema: "product",
          data: { title: "Test Product" },
          createdAt: "2023-01-01T00:00:00.000Z",
          updatedAt: "2023-01-01T00:00:00.000Z",
        },
      ];

      const result = validateSnapshot(schemas, records);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("validates snapshot with errors", () => {
      const schemas: SchemaDef[] = [
        {
          name: "product",
          fields: [], // No fields (invalid)
        },
        {
          name: "", // Empty name (invalid)
          fields: [],
        },
      ];

      const records: EntityRecord[] = [
        {
          id: "prod-1",
          schema: "product",
          data: { title: "Test Product" },
          createdAt: "invalid-date", // Invalid date
          updatedAt: "2023-01-01T00:00:00.000Z",
        },
      ];

      const result = validateSnapshot(schemas, records);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("collects warnings from validation", () => {
      const schemas: SchemaDef[] = [
        {
          name: "product",
          fields: [
            { name: "title", type: "string", required: true, defaultValue: "Default" }, // Warning: required with default
          ],
        },
      ];

      const records: EntityRecord[] = [
        {
          id: "prod-1",
          schema: "product",
          data: { title: "Test Product", unknownField: "test" }, // Warning: unknown field
          createdAt: "2023-01-02T00:00:00.000Z",
          updatedAt: "2023-01-01T00:00:00.000Z", // Warning: updated before created
        },
      ];

      const result = validateSnapshot(schemas, records);

      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});