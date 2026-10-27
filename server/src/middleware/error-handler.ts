import type { ErrorRequestHandler } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { AppError } from "./app-error.js";

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({
      error: { code: "INVALID_JSON", message: "Request body must be valid JSON." },
    });
    return;
  }

  if (error instanceof mongoose.Error.CastError) {
    response.status(400).json({
      error: { code: "INVALID_ID", message: "The supplied identifier is invalid." },
    });
    return;
  }

  if (isDuplicateKeyError(error)) {
    response.status(409).json({
      error: { code: "CONFLICT", message: "A record with that email already exists." },
    });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    response.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Stored data failed validation." },
    });
    return;
  }

  if (
    error instanceof mongoose.Error.MongooseServerSelectionError ||
    error instanceof mongoose.Error
  ) {
    response.status(503).json({
      error: { code: "DATABASE_UNAVAILABLE", message: "The service is temporarily unavailable." },
    });
    return;
  }

  console.error("Unhandled API error:", error instanceof Error ? error.name : "UnknownError");
  response.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
  });
};

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
