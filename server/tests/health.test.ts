import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("returns a healthy API response without requiring a database connection", async () => {
    const app = createApp({
      CLIENT_ORIGIN: "http://localhost:5173",
      NODE_ENV: "test",
      JWT_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
      JWT_ACCESS_TOKEN_TTL_SECONDS: 900,
    });
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "taskboard-api" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
