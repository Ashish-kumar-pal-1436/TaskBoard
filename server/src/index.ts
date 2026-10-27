import { createApp } from "./app.js";
import { connectToDatabase, disconnectFromDatabase } from "./config/database.js";
import { loadEnvironment } from "./config/env.js";

const environmentResult = loadEnvironment();

if (!environmentResult.success) {
  console.error("Invalid server configuration:", environmentResult.error.flatten().fieldErrors);
  process.exit(1);
}

const environment = environmentResult.data;

try {
  await connectToDatabase(environment.MONGODB_URI);
  const app = createApp(environment);
  const server = app.listen(environment.PORT, () => {
    console.info(`Taskboard API listening on port ${environment.PORT}`);
  });

  const shutdown = (signal: string) => {
    console.info(`Received ${signal}; shutting down.`);
    server.close(() => {
      void disconnectFromDatabase()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          console.error("Failed to close the database connection:", error instanceof Error ? error.name : "UnknownError");
          process.exit(1);
        });
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
} catch (error) {
  console.error(
    "Failed to connect to the database.",
    error instanceof Error ? error.name : "UnknownError",
  );
  process.exit(1);
}
