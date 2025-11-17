import { SchemaValidationError, ValidationError } from "../core/errors.js";
import {
  type EntityRecord,
  type FieldDef,
  isEntityRecord,
  isSchemaDef,
  type SchemaDef,
} from "../core/types.js";

/**
 * Validation result with errors and warnings.
 */
export interface ValidationResult {
  /** Whether the data is valid */
  isValid: boolean;

  /** List of validation errors */
  errors: ValidationError[];

  /** List of validation warnings */
  warnings: string[];
}

/**
 * Validator for CMS schemas and records.
 */
export class CMSValidator {
  private schemas: Map<string, SchemaDef> = new Map();

  /**
   * Register a schema for validation.
   */
  registerSchema(schema: SchemaDef): void {
    // Validate the schema itself
    const schemaResult = this.validateSchema(schema);
    if (!schemaResult.isValid) {
      throw new SchemaValidationError(
        `Invalid schema '${schema.name}': ${schemaResult.errors.map((e) => e.message).join(", ")}`,
      );
    }

    this.schemas.set(schema.name, schema);
  }

  /**
   * Register multiple schemas.
   */
  registerSchemas(schemas: SchemaDef[]): void {
    for (const schema of schemas) {
      this.registerSchema(schema);
    }
  }

  /**
   * Get a registered schema by name.
   */
  getSchema(name: string): SchemaDef | undefined {
    return this.schemas.get(name);
  }

  /**
   * Get all registered schemas.
   */
  getAllSchemas(): SchemaDef[] {
    return Array.from(this.schemas.values());
  }

  /**
   * Clear all registered schemas.
   */
  clearSchemas(): void {
    this.schemas.clear();
  }

  /**
   * Validate a schema definition.
   */
  validateSchema(schema: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!isSchemaDef(schema)) {
      errors.push(
        new ValidationError("Invalid schema structure", undefined, schema),
      );
      return { isValid: false, errors, warnings };
    }

    // Check for duplicate field names
    const fieldNames = new Set<string>();
    for (const field of schema.fields) {
      if (fieldNames.has(field.name)) {
        errors.push(
          new ValidationError(
            `Duplicate field name '${field.name}'`,
            field.name,
            field,
          ),
        );
      } else {
        fieldNames.add(field.name);
      }

      // Validate individual field
      const fieldResult = this.validateField(field);
      errors.push(...fieldResult.errors);
      warnings.push(...fieldResult.warnings);
    }

    // Check required fields
    for (const field of schema.fields) {
      if (field.required && field.defaultValue !== undefined) {
        warnings.push(`Required field '${field.name}' has default value`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a field definition.
   */
  validateField(field: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!field || typeof field !== "object") {
      errors.push(
        new ValidationError("Field must be an object", undefined, field),
      );
      return { isValid: false, errors, warnings };
    }

    const fieldObj = field as Record<string, unknown>;

    if (!fieldObj.name || typeof fieldObj.name !== "string") {
      errors.push(
        new ValidationError(
          "Field name is required and must be a string",
          "name",
          field,
        ),
      );
    }

    if (!fieldObj.type || typeof fieldObj.type !== "string") {
      errors.push(
        new ValidationError(
          "Field type is required and must be a string",
          "type",
          field,
        ),
      );
    }

    // Validate field name format
    if (fieldObj.name && typeof fieldObj.name === "string") {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fieldObj.name)) {
        errors.push(
          new ValidationError(
            `Field name '${fieldObj.name}' contains invalid characters. Use letters, numbers, and underscores, starting with a letter or underscore.`,
            "name",
            field,
          ),
        );
      }

      if (fieldObj.name.startsWith("_")) {
        warnings.push(
          `Field name '${fieldObj.name}' starts with underscore (reserved for system fields)`,
        );
      }
    }

    // Validate relation fields
    if (fieldObj.type === "relation" && fieldObj.relationSchema) {
      if (!this.schemas.has(fieldObj.relationSchema)) {
        warnings.push(
          `Relation field '${fieldObj.name}' references unknown schema '${fieldObj.relationSchema}'`,
        );
      }
    }

    // Validate media fields
    if (fieldObj.type === "media" && fieldObj.acceptedTypes) {
      if (!Array.isArray(fieldObj.acceptedTypes)) {
        errors.push(
          new ValidationError(
            "acceptedTypes must be an array",
            "acceptedTypes",
            field,
          ),
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate an entity record against its schema.
   */
  validateRecord(record: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    if (!isEntityRecord(record)) {
      errors.push(
        new ValidationError("Invalid record structure", undefined, record),
      );
      return { isValid: false, errors, warnings };
    }

    const schema = this.schemas.get(record.schema);
    if (!schema) {
      errors.push(
        new ValidationError(
          `Unknown schema '${record.schema}'`,
          "schema",
          record,
        ),
      );
      return { isValid: false, errors, warnings };
    }

    return this.validateRecordData(record, schema);
  }

  /**
   * Validate record data against a schema.
   */
  validateRecordData(
    record: EntityRecord,
    schema: SchemaDef,
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    const data = record.data || {};

    // Check required fields
    for (const field of schema.fields) {
      const hasValue =
        data[field.name] !== undefined && data[field.name] !== null;

      if (field.required && !hasValue) {
        errors.push(
          new ValidationError(
            `Required field '${field.name}' is missing`,
            field.name,
            data[field.name],
          ),
        );
      }

      if (hasValue) {
        const fieldResult = this.validateFieldValue(
          data[field.name],
          field,
          schema,
        );
        errors.push(...fieldResult.errors);
        warnings.push(...fieldResult.warnings);
      }
    }

    // Check for unknown fields
    const knownFields = new Set(schema.fields.map((f) => f.name));
    const unknownFields = Object.keys(data).filter(
      (key) => !knownFields.has(key),
    );

    if (unknownFields.length > 0) {
      warnings.push(`Unknown fields: ${unknownFields.join(", ")}`);
    }

    // Validate timestamps
    if (!record.createdAt || !this.isValidISODate(record.createdAt)) {
      errors.push(
        new ValidationError(
          "Invalid createdAt timestamp",
          "createdAt",
          record.createdAt,
        ),
      );
    }

    if (!record.updatedAt || !this.isValidISODate(record.updatedAt)) {
      errors.push(
        new ValidationError(
          "Invalid updatedAt timestamp",
          "updatedAt",
          record.updatedAt,
        ),
      );
    }

    if (record.updatedAt < record.createdAt) {
      warnings.push("updatedAt timestamp is before createdAt timestamp");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single field value.
   */
  private validateFieldValue(
    value: unknown,
    field: FieldDef,
    _schema: SchemaDef,
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    try {
      switch (field.type) {
        case "string":
          if (typeof value !== "string") {
            errors.push(
              new ValidationError(
                `Field '${field.name}' must be a string`,
                field.name,
                value,
              ),
            );
          }
          break;

        case "number":
          if (typeof value !== "number" || Number.isNaN(value)) {
            errors.push(
              new ValidationError(
                `Field '${field.name}' must be a valid number`,
                field.name,
                value,
              ),
            );
          }
          break;

        case "boolean":
          if (typeof value !== "boolean") {
            errors.push(
              new ValidationError(
                `Field '${field.name}' must be a boolean`,
                field.name,
                value,
              ),
            );
          }
          break;

        case "date":
          if (typeof value !== "string" || !this.isValidISODate(value)) {
            errors.push(
              new ValidationError(
                `Field '${field.name}' must be a valid ISO date string`,
                field.name,
                value,
              ),
            );
          }
          break;

        case "relation":
          if (field.relationSchema) {
            // Can be a single ID or array of IDs
            if (Array.isArray(value)) {
              for (let i = 0; i < value.length; i++) {
                if (typeof value[i] !== "string") {
                  errors.push(
                    new ValidationError(
                      `Field '${field.name}'[${i}] must be a string (record ID)`,
                      field.name,
                      value[i],
                    ),
                  );
                }
              }
            } else if (typeof value !== "string") {
              errors.push(
                new ValidationError(
                  `Field '${field.name}' must be a string or array of strings (record IDs)`,
                  field.name,
                  value,
                ),
              );
            }
          }
          break;

        case "media":
          if (typeof value !== "string" && typeof value !== "object") {
            errors.push(
              new ValidationError(
                `Field '${field.name}' must be a string (URL) or object (media info)`,
                field.name,
                value,
              ),
            );
          }
          break;

        case "json":
          if (typeof value !== "object" && typeof value !== "string") {
            errors.push(
              new ValidationError(
                `Field '${field.name}' must be a JSON object or string`,
                field.name,
                value,
              ),
            );
          }
          break;

        default:
          // For unknown field types, we can't validate specifically
          warnings.push(
            `Unknown field type '${field.type}' for field '${field.name}'`,
          );
      }
    } catch (error) {
      errors.push(
        new ValidationError(
          `Validation error for field '${field.name}': ${error instanceof Error ? error.message : String(error)}`,
          field.name,
          value,
        ),
      );
    }

    // Apply custom constraints if any
    if (field.constraints) {
      const constraintResult = this.validateConstraints(
        value,
        field.constraints,
        field.name,
      );
      errors.push(...constraintResult.errors);
      warnings.push(...constraintResult.warnings);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate field constraints.
   */
  private validateConstraints(
    value: unknown,
    constraints: Record<string, unknown>,
    fieldName: string,
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    for (const [constraintName, constraintValue] of Object.entries(
      constraints,
    )) {
      try {
        switch (constraintName) {
          case "min":
            if (
              typeof value === "number" &&
              value < (constraintValue as number)
            ) {
              errors.push(
                new ValidationError(
                  `Value must be >= ${constraintValue}`,
                  fieldName,
                  value,
                ),
              );
            }
            if (
              typeof value === "string" &&
              value.length < (constraintValue as number)
            ) {
              errors.push(
                new ValidationError(
                  `String must be at least ${constraintValue} characters`,
                  fieldName,
                  value,
                ),
              );
            }
            break;

          case "max":
            if (
              typeof value === "number" &&
              value > (constraintValue as number)
            ) {
              errors.push(
                new ValidationError(
                  `Value must be <= ${constraintValue}`,
                  fieldName,
                  value,
                ),
              );
            }
            if (
              typeof value === "string" &&
              value.length > (constraintValue as number)
            ) {
              errors.push(
                new ValidationError(
                  `String must be at most ${constraintValue} characters`,
                  fieldName,
                  value,
                ),
              );
            }
            break;

          case "pattern":
            if (
              typeof value === "string" &&
              !new RegExp(constraintValue as string).test(value)
            ) {
              errors.push(
                new ValidationError(
                  `Value does not match required pattern`,
                  fieldName,
                  value,
                ),
              );
            }
            break;

          case "enum":
            if (
              Array.isArray(constraintValue) &&
              !constraintValue.includes(value)
            ) {
              errors.push(
                new ValidationError(
                  `Value must be one of: ${constraintValue.join(", ")}`,
                  fieldName,
                  value,
                ),
              );
            }
            break;

          default:
            warnings.push(
              `Unknown constraint '${constraintName}' for field '${fieldName}'`,
            );
        }
      } catch (error) {
        errors.push(
          new ValidationError(
            `Constraint validation error for '${constraintName}': ${error instanceof Error ? error.message : String(error)}`,
            fieldName,
            value,
          ),
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if a string is a valid ISO date.
   */
  private isValidISODate(dateString: string): boolean {
    const date = new Date(dateString);
    return !Number.isNaN(date.getTime()) && dateString === date.toISOString();
  }
}

/**
 * Create a default validator instance.
 */
export function createValidator(): CMSValidator {
  return new CMSValidator();
}

/**
 * Utility function to validate a record against a list of schemas.
 */
export function validateRecordWithSchemas(
  record: EntityRecord,
  schemas: SchemaDef[],
): ValidationResult {
  const validator = new CMSValidator();
  validator.registerSchemas(schemas);
  return validator.validateRecord(record);
}

/**
 * Utility function to validate all records in a snapshot.
 */
export function validateSnapshot(
  schemas: SchemaDef[],
  records: EntityRecord[],
): ValidationResult {
  const validator = new CMSValidator();
  validator.registerSchemas(schemas);

  const allErrors: ValidationError[] = [];
  const allWarnings: string[] = [];

  // Validate all schemas
  for (const schema of schemas) {
    const result = validator.validateSchema(schema);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  // Validate all records
  for (const record of records) {
    const result = validator.validateRecord(record);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}
