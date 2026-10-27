import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z
    .string()
    .url()
    .refine(
      (value) => new URL(value).origin === value,
      "CLIENT_ORIGIN must be an explicit origin without a path",
    ),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
}).superRefine((environment, context) => {
  const clientHostname = new URL(environment.CLIENT_ORIGIN).hostname;
  const isLoopback =
    clientHostname === "localhost" ||
    clientHostname.endsWith(".localhost") ||
    clientHostname === "127.0.0.1" ||
    clientHostname === "[::1]";
  if (environment.NODE_ENV === "production" && isLoopback) {
    context.addIssue({
      code: "custom",
      path: ["CLIENT_ORIGIN"],
      message: "Production CLIENT_ORIGIN must not use a loopback host",
    });
  }
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env) {
  return environmentSchema.safeParse(source);
}
