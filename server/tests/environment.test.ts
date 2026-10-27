import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../src/config/env.js";

const validEnvironment = {
  CLIENT_ORIGIN: "http://localhost:5173",
  MONGODB_URI: "mongodb://127.0.0.1:27017/taskboard",
  JWT_SECRET: "x".repeat(32),
};

describe("server environment", () => {
  it("rejects missing required configuration without exposing values", () => {
    const result = loadEnvironment({});

    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors).toHaveProperty("CLIENT_ORIGIN");
      expect(fieldErrors).toHaveProperty("MONGODB_URI");
      expect(fieldErrors).toHaveProperty("JWT_SECRET");
      expect(JSON.stringify(fieldErrors)).not.toContain("x".repeat(32));
    }
  });

  it("rejects invalid origins, MongoDB schemes, and short JWT secrets", () => {
    const result = loadEnvironment({
      ...validEnvironment,
      CLIENT_ORIGIN: "https://example.test/path",
      MONGODB_URI: "postgres://localhost/taskboard",
      JWT_SECRET: "too-short",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors).toHaveProperty("CLIENT_ORIGIN");
      expect(fieldErrors).toHaveProperty("MONGODB_URI");
      expect(fieldErrors).toHaveProperty("JWT_SECRET");
      expect(JSON.stringify(fieldErrors)).not.toContain("too-short");
    }
  });

  it("accepts local MongoDB configuration and the Vite development origin", () => {
    const result = loadEnvironment(validEnvironment);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CLIENT_ORIGIN).toBe("http://localhost:5173");
      expect(new URL(result.data.MONGODB_URI).protocol).toBe("mongodb:");
    }
  });
});
