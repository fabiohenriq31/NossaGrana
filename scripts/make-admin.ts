import "dotenv/config";
import { prisma } from "../apps/api/src/db";

/**
 * Define quem administra o Coflu. A pessoa se cadastra normalmente pelo site e depois:
 *
 *   pnpm admin:definir voce@email.com            → vira administrador
 *   pnpm admin:definir voce@email.com --remover  → volta a ser usuário comum
 *
 * Alternativa sem terminal: coloque o e-mail em ADMIN_EMAILS no Render; o papel é aplicado
 * no próximo login.
 */
const [email, flag] = process.argv.slice(2);
if (!email || !email.includes("@"))
  throw new Error("Uso: pnpm admin:definir voce@email.com [--remover]");
const user = await prisma.user.findUnique({
  where: { email: email.trim().toLowerCase() },
});
if (!user)
  throw new Error(
    "Nenhuma conta com este e-mail. Cadastre-se no site primeiro.",
  );
const role = flag === "--remover" ? "USER" : "ADMIN";
if (
  role === "USER" &&
  (await prisma.user.count({ where: { role: "ADMIN", active: true } })) <= 1
)
  throw new Error(
    "Esta é a única conta de administrador; defina outra antes de remover.",
  );
await prisma.user.update({
  where: { id: user.id },
  // Novo papel vale na hora; a sessão atual segue válida.
  data: { role },
});
console.log(
  user.name +
    " (" +
    user.email +
    ") agora é " +
    (role === "ADMIN" ? "administrador." : "usuário comum."),
);
await prisma.$disconnect();
