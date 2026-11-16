import { execSync } from "node:child_process";
import { resolve } from "node:path";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://privateride:privateride_dev@localhost:5432/privateride_test";

export default function globalSetup(): void {
  try {
    execSync(`createdb privateride_test`, {
      env: {
        ...process.env,
        PGUSER: "privateride",
        PGPASSWORD: "privateride_dev",
        PGHOST: "localhost",
      },
      stdio: "pipe",
    });
  } catch {
    // Database already exists.
  }
  execSync("pnpm exec prisma migrate deploy", {
    cwd: resolve(__dirname, "../../../packages/database"),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
}
