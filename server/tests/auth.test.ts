import { compare } from "bcryptjs";
import { SignJWT } from "jose";
import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/features/auth/auth.service.js";
import type {
  NewUser,
  UserRecord,
  UserRepository,
} from "../src/features/auth/user.repository.js";

const SECRET = "test-secret-that-is-at-least-thirty-two-characters";
const credentials = {
  email: "asha@example.com",
  displayName: "Asha Rao",
  password: "A-good-password-42",
};

class MemoryUserRepository implements UserRepository {
  private readonly records = new Map<string, UserRecord>();

  async create(input: NewUser): Promise<UserRecord> {
    if ([...this.records.values()].some((user) => user.email === input.email)) {
      throw { code: 11000 };
    }
    const user: UserRecord = {
      id: new mongoose.Types.ObjectId().toString(),
      ...input,
      tokenVersion: 0,
    };
    this.records.set(user.id, user);
    return user;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return [...this.records.values()].find((user) => user.email === email) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.records.get(id) ?? null;
  }

  async incrementTokenVersion(id: string): Promise<void> {
    const user = this.records.get(id);
    if (user) user.tokenVersion += 1;
  }

  get all(): UserRecord[] {
    return [...this.records.values()];
  }
}

function setup() {
  const users = new MemoryUserRepository();
  const auth = new AuthService(users, SECRET, 900);
  const app = createApp(
    {
      CLIENT_ORIGIN: "http://localhost:5173",
      NODE_ENV: "test",
      JWT_SECRET: SECRET,
      JWT_ACCESS_TOKEN_TTL_SECONDS: 900,
    },
    auth,
  );
  return { app, users };
}

describe("authentication API", () => {
  it("registers an account, hashes its password, and returns only a public user", async () => {
    const { app, users } = setup();
    const response = await request(app).post("/api/auth/register").send(credentials);

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: credentials.email,
      displayName: credentials.displayName,
    });
    expect(response.body.user).not.toHaveProperty("passwordHash");
    expect(response.body).not.toHaveProperty("token");
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(users.all).toHaveLength(1);
    expect(users.all[0].passwordHash).not.toBe(credentials.password);
    expect(await compare(credentials.password, users.all[0].passwordHash)).toBe(true);
  });

  it("rejects duplicate email addresses case-insensitively", async () => {
    const { app } = setup();
    await request(app).post("/api/auth/register").send(credentials);

    const response = await request(app)
      .post("/api/auth/register")
      .send({ ...credentials, email: " ASHA@EXAMPLE.COM " });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EMAIL_IN_USE");
  });

  it("validates registration input on the server", async () => {
    const { app } = setup();
    const response = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", displayName: "A", password: "short" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "email" }),
        expect.objectContaining({ field: "displayName" }),
        expect.objectContaining({ field: "password" }),
      ]),
    );
  });

  it("logs in with valid credentials and issues an HttpOnly cookie", async () => {
    const { app } = setup();
    await request(app).post("/api/auth/register").send(credentials);

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: credentials.email, password: credentials.password });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(credentials.email);
    expect(response.body.user).not.toHaveProperty("passwordHash");
    expect(response.headers["set-cookie"][0]).toContain("taskboard_access=");
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
  });

  it("does not reveal whether an email exists when credentials are incorrect", async () => {
    const { app } = setup();
    await request(app).post("/api/auth/register").send(credentials);

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: credentials.email, password: "incorrect-password" });

    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect.",
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects unauthenticated access to the current-user endpoint", async () => {
    const { app } = setup();
    const response = await request(app).get("/api/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a validly signed token containing an invalid ObjectId", async () => {
    const { app } = setup();
    const token = await new SignJWT({ ver: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("not-an-object-id")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(SECRET));

    const response = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `taskboard_access=${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns the authenticated current user without private fields", async () => {
    const { app } = setup();
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send(credentials);

    const response = await agent.get("/api/auth/me");

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      email: credentials.email,
      displayName: credentials.displayName,
    });
    expect(response.body.user).not.toHaveProperty("passwordHash");
  });

  it("revokes existing access cookies when logging out", async () => {
    const { app } = setup();
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send(credentials);

    const logout = await agent.post("/api/auth/logout");
    const currentUser = await agent.get("/api/auth/me");

    expect(logout.status).toBe(204);
    expect(currentUser.status).toBe(401);
  });
});
