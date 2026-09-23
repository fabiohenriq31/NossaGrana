import { spawn } from "node:child_process";
import { config } from "dotenv";
config({ quiet: true });
if (!process.env.DATABASE_URL || !process.env.DIRECT_URL)
  throw new Error(
    "Configure DATABASE_URL e DIRECT_URL do Supabase no .env. Nenhum banco ou seed será criado automaticamente.",
  );
const children = [];
for (const args of [
  ["--import", "tsx", "apps/api/src/server.ts"],
  ["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"],
]) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", () =>
    console.error("Não foi possível iniciar um serviço."),
  );
}
console.log(
  "Coflu em http://127.0.0.1:5173. API conectada exclusivamente ao DATABASE_URL configurado.",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const child of children) child.kill("SIGTERM");
    process.exit(0);
  });
