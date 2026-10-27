import { compare, hash } from "bcryptjs";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import mongoose from "mongoose";
import { AppError } from "../../middleware/app-error.js";
import type { LoginInput, RegisterInput } from "./auth.validation.js";
import type { UserRecord, UserRepository } from "./user.repository.js";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
}

export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    private readonly users: UserRepository,
    secret: string,
    readonly tokenTtlSeconds: number,
  ) {
    this.secret = new TextEncoder().encode(secret);
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const passwordHash = await hash(input.password, 12);
    let user: UserRecord;

    try {
      user = await this.users.create({
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new AppError(409, "EMAIL_IN_USE", "An account with that email already exists.");
      }
      throw error;
    }

    return { user: toPublicUser(user), token: await this.issueToken(user) };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    return { user: toPublicUser(user), token: await this.issueToken(user) };
  }

  async authenticate(token: string): Promise<PublicUser | null> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.secret, { algorithms: ["HS256"] }));
    } catch (error) {
      if (error instanceof joseErrors.JOSEError) {
        return null;
      }
      throw error;
    }

    if (
      typeof payload.sub !== "string" ||
      !mongoose.isObjectIdOrHexString(payload.sub) ||
      typeof payload.ver !== "number"
    ) {
      return null;
    }

    const user = await this.users.findById(payload.sub);
    if (!user || payload.ver !== user.tokenVersion) {
      return null;
    }
    return toPublicUser(user);
  }

  async logout(userId: string): Promise<void> {
    await this.users.incrementTokenVersion(userId);
  }

  private async issueToken(user: UserRecord): Promise<string> {
    return new SignJWT({ ver: user.tokenVersion })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + this.tokenTtlSeconds)
      .sign(this.secret);
  }
}

function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
