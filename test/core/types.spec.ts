import { describe, expect, it } from "vitest";

import {
  type EntityRecord,
  FIELD_TYPES,
  isEntityRecord,
  isSchemaDef,
  isValidRecordId,
  isValidSchemaName,
  type RemoteSnapshot,
  type SchemaDef,
} from "../../src/core/types";

describe("Core Types", () => {
  describe("FIELD_TYPES", () => {
    it("contains all expected field types", () => {
      expect(FIELD_TYPES.STRING).toBe("string");
      expect(FIELD_TYPES.NUMBER).toBe("number");
      expect(FIELD_TYPES.BOOLEAN).toBe("boolean");
      expect(FIELD_TYPES.DATE).toBe("date");
      expect(FIELD_TYPES.RICH_TEXT).toBe("rich_text");
      expect(FIELD_TYPES.RELATION).toBe("relation");
      expect(FIELD_TYPES.MEDIA).toBe("media");
      expect(FIELD_TYPES.JSON).toBe("json");
    });
  });

  describe("Type Guards", () => {
    describe("isValidSchemaName", () => {
      it("returns true for valid schema names", () => {
        expect(isValidSchemaName("product")).toBe(true);
        expect(isValidSchemaName("user-profile")).toBe(true);
        expect(isValidSchemaName("Category")).toBe(true);
      });

      it("returns false for invalid schema names", () => {
        expect(isValidSchemaName("")).toBe(false);
        expect(isValidSchemaName(null)).toBe(false);
        expect(isValidSchemaName(undefined)).toBe(false);
        expect(isValidSchemaName(123)).toBe(false);
        expect(isValidSchemaName({})).toBe(false);
      });
    });

    describe("isValidRecordId", () => {
      it("returns true for valid record IDs", () => {
        expect(isValidRecordId("prod-123")).toBe(true);
        expect(isValidRecordId("user_456")).toBe(true);
        expect(isValidRecordId("abc")).toBe(true);
      });

      it("returns false for invalid record IDs", () => {
        expect(isValidRecordId("")).toBe(false);
        expect(isValidRecordId(null)).toBe(false);
        expect(isValidRecordId(undefined)).toBe(false);
        expect(isValidRecordId(123)).toBe(false);
        expect(isValidRecordId({})).toBe(false);
      });
    });

    describe("isSchemaDef", () => {
      it("returns true for valid schema definitions", () => {
        const validSchema: SchemaDef = {
          name: "product",
          fields: [
            { name: "title", type: "string", required: true },
            { name: "price", type: "number", required: true },
          ],
        };
        expect(isSchemaDef(validSchema)).toBe(true);
      });

      it("returns false for invalid schema definitions", () => {
        expect(isSchemaDef(null)).toBe(false);
        expect(isSchemaDef(undefined)).toBe(false);
        expect(isSchemaDef({})).toBe(false);
        expect(isSchemaDef({ name: "test" })).toBe(false); // missing fields
        expect(isSchemaDef({ fields: [] })).toBe(false); // missing name
        expect(isSchemaDef({ name: "", fields: [] })).toBe(false); // empty name
        expect(isSchemaDef({ name: "test", fields: "not-an-array" })).toBe(
          false,
        );
      });
    });

    describe("isEntityRecord", () => {
      it("returns true for valid entity records", () => {
        const validRecord: EntityRecord = {
          id: "prod-123",
          schema: "product",
          data: { title: "Test Product", price: 99.99 },
          createdAt: "2023-01-01T00:00:00.000Z",
          updatedAt: "2023-01-01T00:00:00.000Z",
        };
        expect(isEntityRecord(validRecord)).toBe(true);
      });

      it("returns false for invalid entity records", () => {
        expect(isEntityRecord(null)).toBe(false);
        expect(isEntityRecord(undefined)).toBe(false);
        expect(isEntityRecord({})).toBe(false);
        expect(isEntityRecord({ id: "test" })).toBe(false); // missing schema
        expect(isEntityRecord({ schema: "test" })).toBe(false); // missing id
        expect(
          isEntityRecord({
            id: "",
            schema: "test",
            data: {},
            createdAt: "",
            updatedAt: "",
          }),
        ).toBe(false); // empty id
        expect(
          isEntityRecord({
            id: "test",
            schema: "",
            data: {},
            createdAt: "",
            updatedAt: "",
          }),
        ).toBe(false); // empty schema
      });
    });
  });

  describe("Type Validation", () => {
    describe("SchemaDef", () => {
      it("validates schema structure", () => {
        const schema: SchemaDef = {
          name: "blog-post",
          label: "Blog Post",
          description: "A blog post with title and content",
          fields: [
            {
              name: "title",
              type: "string",
              required: true,
              label: "Title",
            },
            {
              name: "content",
              type: "rich_text",
              required: true,
              label: "Content",
            },
            {
              name: "published",
              type: "boolean",
              required: false,
              defaultValue: false,
            },
            {
              name: "author",
              type: "relation",
              relationSchema: "user",
              required: true,
            },
          ],
          display: {
            icon: "document",
            defaultSort: "createdAt",
            defaultSortDirection: "desc",
          },
        };

        expect(isSchemaDef(schema)).toBe(true);
      });
    });

    describe("EntityRecord", () => {
      it("validates record structure", () => {
        const record: EntityRecord = {
          id: "post-123",
          schema: "blog-post",
          data: {
            title: "My First Post",
            content: "This is the content...",
            published: true,
            author: "user-456",
          },
          createdAt: "2023-01-01T10:00:00.000Z",
          updatedAt: "2023-01-02T15:30:00.000Z",
          meta: {
            version: 2,
            publishedAt: "2023-01-02T15:30:00.000Z",
          },
        };

        expect(isEntityRecord(record)).toBe(true);
      });
    });

    describe("RemoteSnapshot", () => {
      it("validates snapshot structure", () => {
        const snapshot: RemoteSnapshot = {
          commitId: "abc123def456",
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
              data: { title: "Test Product", price: 29.99 },
              createdAt: "2023-01-01T00:00:00.000Z",
              updatedAt: "2023-01-01T00:00:00.000Z",
            },
          ],
          meta: {
            fetchedAt: "2023-01-01T12:00:00.000Z",
            size: {
              schemasCount: 1,
              recordsCount: 1,
              bytes: 1024,
            },
          },
        };

        // Snapshot should have proper structure
        expect(typeof snapshot.commitId).toBe("string");
        expect(Array.isArray(snapshot.schemas)).toBe(true);
        expect(Array.isArray(snapshot.records)).toBe(true);
        expect(snapshot.schemas.length).toBe(1);
        expect(snapshot.records.length).toBe(1);
        expect(isSchemaDef(snapshot.schemas[0])).toBe(true);
        expect(isEntityRecord(snapshot.records[0])).toBe(true);
      });
    });
  });
});
