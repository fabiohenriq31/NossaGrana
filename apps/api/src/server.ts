import "dotenv/config";
import { buildApp } from "./app";
import { prisma } from "./db";
const app = await buildApp();
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT || 3001) });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
