import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
export const prisma = new PrismaClient();
export async function atomic<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: "Serializable",
        timeout: 20000,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2034" &&
        i < 3
      )
        continue;
      throw e;
    }
  }
}
