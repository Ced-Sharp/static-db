/**
 * Core domain types for the Static DB CMS data layer.
 * These types are runtime-agnostic and define the data model.
 */

export type SchemaName = string;
export type RecordId = string;
export type FieldTypeName = string;

/**
 * Primitive field types supported by the CMS.
 * Implementations can extend this with custom types.
 */
export const FIELD_TYPES = {
  STRING: "string",
  NUMBER: "number",
  BOOLEAN: "boolean",
  DATE: "date",
  RICH_TEXT: "rich_text",
  RELATION: "relation",
  MEDIA: "media",
  JSON: "json",
} as const;

export type FieldType = typeof FIELD_TYPES[keyof typeof FIELD_TYPES];

/**
 * Field definition inside a schema.
 * Implementation is allowed to extend this shape.
 */
export interface FieldDef {
  /** Field key, unique within the schema. */
  name: string;

  /** Primitive type or higher-level CMS field type. */
  type: FieldTypeName;

  /** Whether the field is required. */
  required?: boolean;

  /** Default value for the field if not provided. */
  defaultValue?: unknown;

  /** Optional human-readable label. */
  label?: string;

  /** Optional description for the field. */
  description?: string;

  /** Optional arbitrary constraints (backend-agnostic). */
  constraints?: Record<string, unknown>;

  /** For relation fields, the target schema name. */
  relationSchema?: SchemaName;

  /** For media fields, accepted file types. */
  acceptedTypes?: string[];

  /** Whether field should be indexed for queries. */
  indexed?: boolean;
}

/**
 * Schema/collection definition.
 */
export interface SchemaDef {
  /** Name of the schema/collection (e.g., "product"). */
  name: SchemaName;

  /** Optional label to display in UI. */
  label?: string;

  /** Field definitions for this schema. */
  fields: FieldDef[];

  /** Optional description for docs/UI. */
  description?: string;

  /**
   * Optional version identifier for migrations.
   * Implementations can use this to evolve schemas over time.
   */
  version?: number;

  /** Optional display settings for UI. */
  display?: {
    /** Icon to represent this schema in UI. */
    icon?: string;
    /** Default sort field for listings. */
    defaultSort?: string;
    /** Default sort direction. */
    defaultSortDirection?: "asc" | "desc";
  };
}

/**
 * Represents one "row" / "record" in a schema.
 */
export interface EntityRecord {
  /** Unique identifier of this record. */
  id: RecordId;

  /** Name of the schema this record belongs to. */
  schema: SchemaName;

  /**
   * Actual data payload. Keys should match FieldDef names inside the schema.
   */
  data: Record<string, unknown>;

  /** ISO timestamp when the record was created. */
  createdAt: string;

  /** ISO timestamp when the record was last updated. */
  updatedAt: string;

  /**
   * Optional additional metadata:
   * - createdBy, updatedBy, version, etc.
   */
  meta?: Record<string, unknown>;
}

/**
 * A complete view of the remote data at a point in time.
 *
 * - For Git-based backends, `commitId` will be a commit SHA.
 * - For Firestore, it might be a logical version or timestamp.
 */
export interface RemoteSnapshot {
  /** Remote "version" identifier (commit SHA, timestamp, etc.). */
  commitId: string;

  /** All schemas known to the system. */
  schemas: SchemaDef[];

  /** All records across all schemas. */
  records: EntityRecord[];

  /** Optional metadata about the snapshot. */
  meta?: {
    /** When this snapshot was created/fetched. */
    fetchedAt?: string;
    /** Size information for debugging. */
    size?: {
      schemasCount: number;
      recordsCount: number;
      bytes?: number;
    };
  };
}

/**
 * Utility type for extracting data from EntityRecord.
 */
export type RecordData<T extends SchemaDef> = {
  [K in T["fields"][number]["name"]]: T["fields"][number]["type"] extends "string"
    ? string
    : T["fields"][number]["type"] extends "number"
    ? number
    : T["fields"][number]["type"] extends "boolean"
    ? boolean
    : T["fields"][number]["type"] extends "date"
    ? string // ISO date
    : T["fields"][number]["type"] extends "relation"
    ? RecordId | RecordId[]
    : unknown;
};

/**
 * Type guard to check if a value is a valid SchemaName.
 */
export function isValidSchemaName(value: unknown): value is SchemaName {
  return typeof value === "string" && value.length > 0;
}

/**
 * Type guard to check if a value is a valid RecordId.
 */
export function isValidRecordId(value: unknown): value is RecordId {
  return typeof value === "string" && value.length > 0;
}

/**
 * Type guard to check if an object is a SchemaDef.
 */
export function isSchemaDef(value: unknown): value is SchemaDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    isValidSchemaName((value as SchemaDef).name) &&
    "fields" in value &&
    Array.isArray((value as SchemaDef).fields)
  );
}

/**
 * Type guard to check if an object is an EntityRecord.
 */
export function isEntityRecord(value: unknown): value is EntityRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    isValidRecordId((value as EntityRecord).id) &&
    "schema" in value &&
    isValidSchemaName((value as EntityRecord).schema) &&
    "data" in value &&
    typeof (value as EntityRecord).data === "object" &&
    (value as EntityRecord).data !== null &&
    "createdAt" in value &&
    "updatedAt" in value
  );
}