import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  if (!process.env[key]) throw new Error(key + " ausente");
  const url = new URL(process.env[key]);
  if (["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error(key + " ainda aponta para banco local");
}
const p = new PrismaClient();
try {
  const role =
    await p.$queryRaw`SELECT current_user AS name, rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user`;
  const tables =
    await p.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'`;
  if (["anon", "authenticated"].includes(role[0].name))
    throw new Error(
      "A conexão precisa de uma função de banco exclusiva do backend",
    );
  console.log(
    JSON.stringify({
      connected: true,
      backendRole: role[0].name,
      roleBypassesRls: role[0].rolbypassrls,
      tables: tables.map((t) => t.table_name),
    }),
  );
  writeFileSync(
    "docs/supabase-preflight.json",
    JSON.stringify(
      {
        connected: true,
        roleBypassesRls: role[0].rolbypassrls,
        existingTables: tables.map((t) => t.table_name),
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error("Falha na conexão: " + (e.code || e.name));
  process.exitCode = 1;
} finally {
  await p.$disconnect();
}
