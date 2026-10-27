import { Router, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { AppError } from "../../middleware/app-error.js";
import { AuthService } from "./auth.service.js";
import { loginSchema, registerSchema } from "./auth.validation.js";

const ACCESS_COOKIE = "taskboard_access";

export function createAuthRouter(auth: AuthService, production: boolean) {
  const router = Router();
  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." },
    },
  });

  const sameOrigin: RequestHandler = (request, _response, next) => {
    const origin = request.get("origin");
    if (origin && origin !== request.app.get("clientOrigin")) {
      next(new AppError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed."));
      return;
    }
    next();
  };

  router.post("/register", authRateLimit, sameOrigin, async (request, response) => {
    const input = registerSchema.parse(request.body);
    const result = await auth.register(input);
    setAccessCookie(response, result.token, auth.tokenTtlSeconds, production);
    response.status(201).json({ user: result.user });
  });

  router.post("/login", authRateLimit, sameOrigin, async (request, response) => {
    const input = loginSchema.parse(request.body);
    const result = await auth.login(input);
    setAccessCookie(response, result.token, auth.tokenTtlSeconds, production);
    response.status(200).json({ user: result.user });
  });

  router.get("/me", requireAuthenticatedUser(auth), (_request, response) => {
    response.status(200).json({ user: response.locals.authUser });
  });

  router.post("/logout", sameOrigin, async (request, response) => {
    const token: unknown = request.cookies?.[ACCESS_COOKIE];
    if (typeof token === "string") {
      const user = await auth.authenticate(token);
      if (user) await auth.logout(user.id);
    }
    clearAccessCookie(response, production);
    response.status(204).end();
  });

  return router;
}

export function requireAuthenticatedUser(auth: AuthService): RequestHandler {
  return async (request, response, next) => {
    const token: unknown = request.cookies?.[ACCESS_COOKIE];
    if (typeof token !== "string") {
      next(new AppError(401, "UNAUTHENTICATED", "Sign in to continue."));
      return;
    }

    const user = await auth.authenticate(token);
    if (!user) {
      next(new AppError(401, "UNAUTHENTICATED", "Sign in to continue."));
      return;
    }

    response.locals.authUser = user;
    next();
  };
}

function setAccessCookie(
  response: Response,
  token: string,
  ttlSeconds: number,
  production: boolean,
) {
  response.cookie(ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/api",
    maxAge: ttlSeconds * 1000,
  });
}

function clearAccessCookie(
  response: Response,
  production: boolean,
) {
  response.clearCookie(ACCESS_COOKIE, {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/api",
  });
}
