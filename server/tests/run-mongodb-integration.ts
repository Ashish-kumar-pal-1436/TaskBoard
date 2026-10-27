import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(serverDirectory, "..");
dotenv.config({ path: resolve(repositoryRoot, ".env") });

const uri = process.env.TEST_MONGODB_URI;
if (!uri) {
  console.error(
    "Integration tests require TEST_MONGODB_URI pointing to a dedicated test database.",
  );
  process.exit(1);
}

let databaseName = "";
try {
  const parsedUri = new URL(uri);
  if (!["mongodb:", "mongodb+srv:"].includes(parsedUri.protocol)) {
    throw new Error();
  }
  databaseName = decodeURIComponent(parsedUri.pathname.slice(1));
} catch {
  console.error("TEST_MONGODB_URI is not a valid MongoDB URI.");
  process.exit(1);
}

if (!/(?:^|[_-])test(?:$|[_-])/i.test(databaseName)) {
  console.error(
    'Integration tests refused: the database name must clearly identify a test database (for example, "taskboard_test").',
  );
  process.exit(1);
}

const vitestCli = resolve(serverDirectory, "../node_modules/vitest/vitest.mjs");
const integrationFile = resolve(serverDirectory, "tests/mongodb.integration.test.ts");
const result = spawnSync(process.execPath, [vitestCli, "run", integrationFile], {
  cwd: serverDirectory,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error("Could not start the MongoDB integration test runner.");
  process.exit(1);
}
process.exit(result.status ?? 1);
