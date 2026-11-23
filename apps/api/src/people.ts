import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/** "Casa" é o responsável coletivo; os demais são os membros do núcleo (pelo nome). */
export const RESERVED_PERSON = "Casa";

/** Pessoas que podem ser "dono" de conta, cartão ou lançamento no núcleo. */
export async function householdPeople(
  householdId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const users = await db.user.findMany({
    where: { householdId },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });
  return [...users.map((u) => u.name), RESERVED_PERSON];
}

export async function assertPerson(
  db: Prisma.TransactionClient,
  householdId: string,
  owner: string,
) {
  if (!(await householdPeople(householdId, db)).includes(owner))
    throw Object.assign(
      new Error("Responsável inválido: escolha um membro do núcleo ou Casa."),
      { statusCode: 400 },
    );
}
