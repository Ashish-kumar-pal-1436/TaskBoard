import cors from "cors";
import express from "express";
import type { Environment } from "./config/env.js";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import cookieParser from "cookie-parser";
import { createAuthRouter } from "./features/auth/auth.routes.js";
import { AuthService } from "./features/auth/auth.service.js";
import { MongoUserRepository } from "./features/auth/user.repository.js";
import { createProjectsRouter } from "./features/projects/projects.routes.js";
import { MongoProjectRepository } from "./features/projects/project.repository.js";
import { ProjectService } from "./features/projects/project.service.js";
import { errorHandler } from "./middleware/error-handler.js";

export function createApp(
  environment: Pick<
    Environment,
    "CLIENT_ORIGIN" | "JWT_SECRET" | "JWT_ACCESS_TOKEN_TTL_SECONDS" | "NODE_ENV"
  >,
  authService = new AuthService(
    new MongoUserRepository(),
    environment.JWT_SECRET,
    environment.JWT_ACCESS_TOKEN_TTL_SECONDS,
  ),
  projectService = new ProjectService(
    new MongoProjectRepository(),
    new MongoUserRepository(),
  ),
) {
  const app = express();

  app.disable("x-powered-by");
  app.set("clientOrigin", environment.CLIENT_ORIGIN);
  app.use(helmet());
  app.use(
    cors({
      origin: environment.CLIENT_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );

  app.get("/api/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "taskboard-api" });
  });

  app.use(
    "/api/auth",
    createAuthRouter(authService, environment.NODE_ENV === "production"),
  );
  app.use(
    "/api/projects",
    createProjectsRouter(authService, projectService),
  );
  app.use(errorHandler);

  return app;
}
