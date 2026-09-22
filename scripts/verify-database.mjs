import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
const p = new PrismaClient();
try {
  const permissions =
    await p.$queryRaw`SELECT table_name,has_table_privilege('anon',format('%I.%I',table_schema,table_name),'SELECT,INSERT,UPDATE,DELETE') AS anon_access,has_table_privilege('authenticated',format('%I.%I',table_schema,table_name),'SELECT,INSERT,UPDATE,DELETE') AS authenticated_access FROM information_schema.tables WHERE table_schema='public' AND table_name<>'_prisma_migrations'`;
  const family = await p.household.findUniqueOrThrow({
    where: { id: "nossagrana-family" },
    select: {
      mode: true,
      _count: {
        select: {
          users: true,
          accounts: true,
          cards: true,
          transactions: true,
          categories: true,
        },
      },
    },
  });
  const result = {
    at: new Date().toISOString(),
    family,
    financialTablesPrivate: permissions.every(
      (r) => !r.anon_access && !r.authenticated_access,
    ),
    permissions,
  };
  writeFileSync(
    "docs/database-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      family,
      financialTablesPrivate: result.financialTablesPrivate,
    }),
  );
  if (!result.financialTablesPrivate) process.exitCode = 1;
} finally {
  await p.$disconnect();
}
