import { config } from "dotenv";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
config({quiet: true});
const database = process.env.TEST_DATABASE_URL;
if (!database || !["127.0.0.1", "localhost"].includes(new URL(database).hostname)) {
  throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local isolado. A suíte não utiliza o banco real.");
}
const files = readdirSync("tests").filter(name => name.endsWith(".test.ts")).map(name => "tests/" + name);
const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...files], {
  stdio: "inherit", windowsHide: true,
  env: {...process.env, NODE_ENV: "test", DATABASE_URL: database, DIRECT_URL: database},
});
child.on("error", error => {console.error(error.message);process.exitCode=1;});
child.on("exit", code => {process.exitCode=code ?? 1;});
