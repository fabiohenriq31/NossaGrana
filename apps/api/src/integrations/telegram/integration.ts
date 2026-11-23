import { randomUUID } from "node:crypto";
import { Prisma, type TransactionSuggestion } from "@prisma/client";
import { prisma, atomic } from "../../db";
import type { PrivateAttachmentStorage } from "../../storage";
import {
  OpenAIReceiptAnalyzer,
  type ReceiptAnalyzer,
  type TextAnalysis,
} from "./analyzer";
import {
  TelegramAPI,
  SupabaseAttachmentStorage,
  type TelegramGateway,
  type Keyboard,
} from "./providers";
import {
  opaqueToken,
  hash,
  MAX_FILE_BYTES,
  MIME_TYPES,
  validateFile,
  IntegrationError,
} from "./config";
import { consumeLink, identity, normalizeUpdate, type Event } from "./identity";
import {
  tryQuickConfirm,
  undoQuick,
  quickCategories,
  recategorizeQuick,
} from "./quick";
import {
  buildPayload,
  previewText,
  previewKeyboard,
  ownedImport,
  confirmImport,
  listText,
  type ImportPayload,
} from "./statement";
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const HELP =
  "Como usar:\n• Escreva o gasto: mercado 120 · uber 23,50 ontem · farmácia 90 em 3x\n• Mande o print ou PDF da fatura/lista de compras do cartão e eu lanço tudo, inclusive parcelas\n• Mande comprovante de PIX ou boleto\n• /saldo mostra quanto ainda dá para gastar no mês";
import { budgetStatus, budgetLines, monthLabel } from "../../budget";
import { householdPeople } from "../../people";
import * as credits from "../../billing";
import { getSettings, type UsageKind } from "../../settings";
import {
  saveSuggestion,
  ownedSuggestion,
  householdChoices,
  toInput,
  confirmSuggestion,
  rejectSuggestion,
  editSuggestion,
  editFields,
  pendingStatuses,
  type EditField,
} from "./suggestions";
export interface Dependencies {
  telegram: TelegramGateway;
  storage: PrivateAttachmentStorage;
  analyzer: ReceiptAnalyzer;
  /** Lança direto quando não há dúvida. Ligado por padrão no app; dependências injetadas decidem. */
  quickLaunch?: boolean;
  /** Créditos de IA. Sem isto (testes), nada é cobrado. */
  billing?: Billing;
}
export interface Billing {
  check(householdId: string, kind: UsageKind): Promise<void>;
  reserve(
    householdId: string,
    kind: UsageKind,
  ): Promise<{ charged: number; balance: number | null }>;
  refund(householdId: string, amount: number, note: string): Promise<void>;
}
const realBilling: Billing = {
  check: credits.check,
  reserve: (h, kind) => credits.reserve(h, kind),
  refund: credits.refund,
};
/** Falta de crédito, plano ou IA desligada viram uma resposta direta no Telegram. */
async function billed<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (e instanceof credits.CreditError || status === 503)
      throw new IntegrationError("CREDITS", (e as Error).message);
    throw e;
  }
}
const labels: Record<EditField, string> = {
  description: "Descrição",
  amount: "Valor total (R$)",
  date: "Data",
  type: "Tipo",
  status: "Já pago/recebido ou pendente",
  paymentMethod: "Pagamento",
  account: "Conta de origem",
  destination: "Conta de destino",
  card: "Cartão",
  category: "Categoria",
  subcategory: "Subcategoria",
  owner: "Responsável",
  installments: "Parcelas",
};
export class TelegramIntegration {
  readonly deps: Dependencies;
  private running = false;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(deps?: Dependencies) {
    this.deps = deps || {
      telegram: new TelegramAPI(),
      storage: new SupabaseAttachmentStorage(),
      analyzer: new OpenAIReceiptAnalyzer(),
      quickLaunch: process.env.TELEGRAM_QUICK_LAUNCH !== "false",
      billing: realBilling,
    };
  }
  async accept(body: unknown) {
    let event = normalizeUpdate(body);
    if (!event) return;
    if (event.kind !== "start" && !(await identity(event.senderId))) {
      event = {
        id: event.id,
        senderId: event.senderId,
        chatId: event.chatId,
        kind: "start",
      };
    }
    const acceptedEvent = event;
    await atomic(async (tx) => {
      if (
        await tx.telegramUpdate.findUnique({ where: { id: acceptedEvent.id } })
      )
        return;
      const recent = await tx.telegramUpdate.count({
        where: {
          senderId: acceptedEvent.senderId,
          createdAt: { gt: new Date(Date.now() - 3600000) },
        },
      });
      if (recent >= 40)
        throw Object.assign(
          new Error("Limite de 40 mensagens por hora. Tente mais tarde."),
          { statusCode: 429 },
        );
      await tx.telegramUpdate.create({
        data: {
          id: acceptedEvent.id,
          senderId: acceptedEvent.senderId,
          payload: acceptedEvent as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
  async button(
    s: TransactionSuggestion,
    text: string,
    action: string,
    value?: string,
  ) {
    const token = opaqueToken();
    await prisma.telegramCallback.create({
      data: {
        token,
        suggestionId: s.id,
        version: s.version,
        action,
        value,
        expiresAt: s.expiresAt,
      },
    });
    return { text, callback_data: token };
  }
  async summary(senderId: string, id: string) {
    const { s, who } = await ownedSuggestion(senderId, id);
    if (
      !pendingStatuses.includes(s.status as (typeof pendingStatuses)[number])
    ) {
      await this.deps.telegram.send(
        who.telegramChatId,
        s.status === "CONFIRMED"
          ? "✅ Este lançamento já foi salvo."
          : "Esta sugestão foi encerrada.",
      );
      return;
    }
    const c = await householdChoices(s.householdId);
    const account = c.accounts.find((a) => a.id === s.suggestedAccountId),
      destination = c.accounts.find(
        (a) => a.id === s.suggestedDestinationAccountId,
      );
    const card = c.cards.find((a) => a.id === s.suggestedCreditCardId),
      category = c.categories.find((a) => a.id === s.suggestedCategoryId);
    const parsed = toInput(s),
      errors = parsed.success ? [] : parsed.error.issues.map((x) => x.message);
    const currency =
      s.suggestedAmount == null
        ? "Valor não identificado"
        : (s.suggestedAmount / 100).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          });
    const text = [
      "🧾 Confira antes de salvar",
      s.suggestedType || "Tipo não identificado",
      s.suggestedDescription || "Descrição não identificada",
      "💰 " +
        currency +
        (s.installments > 1 ? " TOTAL · " + s.installments + " parcelas" : ""),
      "📅 " +
        (s.suggestedDate
          ?.toISOString()
          .slice(0, 10)
          .split("-")
          .reverse()
          .join("/") || "Data não identificada"),
      "💳 " + (s.suggestedPaymentMethod || "Selecione o pagamento"),
      "🏦 " +
        (card
          ? card.name + " · final " + card.last4
          : account
            ? account.name + " · " + account.owner
            : "Selecione conta ou cartão"),
      ...(s.suggestedType === "TRANSFERENCIA"
        ? ["Destino: " + (destination?.name || "Selecione a conta")]
        : []),
      "🏷 " + (category?.name || "Selecione a categoria"),
      "Responsável: " + (s.suggestedOwner || "Selecione"),
      "Situação: " +
        (s.suggestedStatus === "CONFIRMADA"
          ? "Já pago/recebido"
          : s.suggestedStatus === "PENDENTE"
            ? "Pendente — ainda não pago/recebido"
            : "Informe se já foi pago/recebido ou está pendente"),
      ...(s.reviewReasons.includes("date_assumed_today")
        ? [
            "📅 Sem data informada: considerei o dia do envio. Confira antes de salvar.",
          ]
        : []),
      ...(s.possibleDuplicate
        ? [
            "⚠️ POSSÍVEL DUPLICATA: confira seus lançamentos antes de confirmar novamente.",
          ]
        : []),
      ...(s.reviewReasons.includes("installments")
        ? [
            "⚠️ Revise VALOR TOTAL e PARCELAS. O valor da parcela não é multiplicado automaticamente.",
          ]
        : []),
      ...(s.reviewReasons.includes("currency")
        ? ["⚠️ Moeda incerta: informe o valor correto em reais."]
        : []),
      ...errors.slice(0, 4).map((x) => "• " + x),
      ...(s.confidence < 0.8
        ? ["⚠️ Leitura incerta: revise cuidadosamente todos os campos."]
        : []),
      "A IA pode errar. Nada foi lançado ainda.",
    ].join("\n");
    const keyboard: Keyboard = [
      [await this.button(s, "✅ Confirmar", "confirm")],
      [
        await this.button(s, "✏️ Editar", "edit"),
        await this.button(s, "🗑 Descartar", "reject"),
      ],
    ];
    if (!account && !card)
      keyboard.push([
        await this.button(s, "Escolher conta", "field", "account"),
        await this.button(s, "Escolher cartão", "field", "card"),
      ]);
    if (!s.suggestedStatus)
      keyboard.push([
        await this.button(s, "Informar situação", "field", "status"),
      ]);
    await this.deps.telegram.send(who.telegramChatId, text, keyboard);
  }
  async choices(senderId: string, s: TransactionSuggestion, field: EditField) {
    const { who } = await ownedSuggestion(senderId, s.id),
      c = await householdChoices(s.householdId);
    let values: { name: string; id: string }[] = [];
    if (field === "account" || field === "destination")
      values = c.accounts.map((a) => ({
        id: a.id,
        name: a.name + " · " + a.owner,
      }));
    if (field === "card")
      values = c.cards.map((a) => ({
        id: a.id,
        name: a.name + " · " + a.owner + " · " + a.last4,
      }));
    if (field === "category") values = c.categories;
    if (field === "subcategory")
      values =
        c.categories.find((c) => c.id === s.suggestedCategoryId)
          ?.subcategories || [];
    if (field === "type")
      values = ["DESPESA", "RECEITA", "TRANSFERENCIA"].map((id) => ({
        id,
        name: id,
      }));
    if (field === "status")
      values = [
        { id: "CONFIRMADA", name: "Já pago/recebido" },
        { id: "PENDENTE", name: "Pendente" },
      ];
    if (field === "paymentMethod")
      values = [
        "PIX",
        "DEBITO",
        "CREDITO",
        "DINHEIRO",
        "BOLETO",
        "TRANSFERENCIA",
        "OUTRO",
      ].map((id) => ({ id, name: id }));
    if (field === "owner")
      values = (await householdPeople(s.householdId)).map((id) => ({
        id,
        name: id,
      }));
    if (["description", "amount", "date", "installments"].includes(field)) {
      await prisma.telegramIdentity.update({
        where: { id: who.id },
        data: {
          editSuggestionId: s.id,
          editField: field,
          editExpiresAt: new Date(Date.now() + 10 * 60000),
        },
      });
      const hint =
        field === "amount"
          ? "Envie o VALOR TOTAL em reais, por exemplo 187,42."
          : field === "date"
            ? "Envie a data no formato AAAA-MM-DD, por exemplo 2026-09-23."
            : field === "installments"
              ? "Envie o número total de parcelas (1 para à vista). Revise também o valor TOTAL."
              : "Envie a descrição corrigida.";
      await this.deps.telegram.send(
        who.telegramChatId,
        hint + " Use /cancelar para sair.",
      );
      return;
    }
    const keyboard: Keyboard = [];
    for (const value of values.slice(0, 80))
      keyboard.push([
        await this.button(s, value.name.slice(0, 60), "set:" + field, value.id),
      ]);
    keyboard.push([await this.button(s, "Voltar ao resumo", "summary")]);
    await this.deps.telegram.send(
      who.telegramChatId,
      values.length
        ? "Escolha: " + labels[field]
        : "Nenhuma opção disponível. Cadastre no aplicativo e tente novamente.",
      keyboard,
    );
  }
  async callback(event: Event) {
    if (event.callbackId)
      await this.deps.telegram.answer(event.callbackId).catch(() => {});
    if (event.token?.startsWith("q:")) return this.quickCallback(event);
    if (event.token?.startsWith("imp:")) return this.importCallback(event);
    const token = await prisma.telegramCallback.findUnique({
      where: { token: event.token || "" },
    });
    if (!token || token.expiresAt <= new Date())
      throw new IntegrationError(
        "CALLBACK_INVALID",
        "Este botão expirou ou é inválido.",
      );
    const { s } = await ownedSuggestion(event.senderId, token.suggestionId);
    if (s.status === "CONFIRMED" && token.action === "confirm") {
      await this.deps.telegram.send(
        event.chatId,
        "✅ Este lançamento já foi salvo. Nenhuma duplicata foi criada.",
      );
      return;
    }
    if (
      s.version !== token.version ||
      !pendingStatuses.includes(s.status as (typeof pendingStatuses)[number])
    )
      throw new IntegrationError(
        "CALLBACK_STALE",
        "Este resumo mudou ou foi encerrado. Use a mensagem mais recente.",
      );
    if (token.action === "confirm") {
      await confirmSuggestion(event.senderId, s.id, token.version);
      await this.deps.telegram.send(
        event.chatId,
        s.suggestedStatus === "PENDENTE"
          ? "✅ Lançamento pendente salvo no Coflu. O saldo só muda quando você marcar como pago/recebido."
          : "✅ Lançamento salvo no Coflu. Seus saldos e relatórios já consideram essa movimentação.",
      );
    } else if (token.action === "reject") {
      await rejectSuggestion(event.senderId, s.id, token.version);
      await this.deps.telegram.send(
        event.chatId,
        "Sugestão descartada. Nenhum lançamento foi criado.",
      );
    } else if (token.action === "edit") {
      const keyboard: Keyboard = [];
      for (const field of editFields)
        keyboard.push([await this.button(s, labels[field], "field", field)]);
      await this.deps.telegram.send(
        event.chatId,
        "O que deseja corrigir?",
        keyboard,
      );
    } else if (
      token.action === "field" &&
      editFields.includes(token.value as EditField)
    ) {
      await this.choices(event.senderId, s, token.value as EditField);
    } else if (
      token.action.startsWith("set:") &&
      editFields.includes(token.action.slice(4) as EditField)
    ) {
      await editSuggestion(
        event.senderId,
        s.id,
        token.version,
        token.action.slice(4) as EditField,
        token.value || "",
      );
      await this.summary(event.senderId, s.id);
    } else if (token.action === "summary")
      await this.summary(event.senderId, s.id);
  }
  async document(event: Event) {
    const who = await identity(event.senderId);
    if (!who)
      throw new IntegrationError(
        "UNLINKED",
        "Conecte seu Telegram nas Configurações.",
      );
    if ((event.fileSize || 0) > MAX_FILE_BYTES)
      throw new IntegrationError("FILE_SIZE", "Envie um arquivo de até 10 MB.");
    if (!MIME_TYPES.includes(event.mime || ""))
      throw new IntegrationError("FILE_TYPE", "Envie JPEG, PNG, WebP ou PDF.");
    const existing = await prisma.transactionSuggestion.findUnique({
      where: { updateId: event.id },
    });
    if (existing) {
      await this.summary(event.senderId, existing.id);
      return;
    }
    const bytes = await this.deps.telegram.download(event.fileId!),
      mime = validateFile(bytes, event.mime!);
    const sha256 = hash(bytes),
      h = who.user.householdId;
    let attachment = await prisma.attachment.findUnique({
      where: { householdId_sha256: { householdId: h, sha256 } },
      include: { suggestion: true },
    });
    if (attachment?.externalImportId) {
      await this.deps.telegram.send(
        event.chatId,
        "📎 Este arquivo já foi recebido antes. Nada foi duplicado.",
      );
      await this.showImport(who, attachment.externalImportId).catch(() => {});
      return;
    }
    if (attachment?.suggestion) {
      await this.deps.telegram.send(
        event.chatId,
        "📎 DUPLICATA EXATA: este arquivo já foi recebido. Nenhum novo lançamento foi criado.",
      );
      if (attachment.suggestion.userId === who.userId)
        await this.summary(event.senderId, attachment.suggestion.id);
      return;
    }
    if (!attachment) {
      const id = randomUUID(),
        extension = mime === "application/pdf" ? "pdf" : mime.split("/")[1];
      attachment = await prisma.attachment.create({
        data: {
          id,
          householdId: h,
          sha256,
          fileName: "comprovante." + extension,
          storagePath: h + "/" + id + "." + extension,
          fileSize: bytes.length,
          mimeType: mime,
          source: "TELEGRAM",
          processingStatus: "PENDING",
          expiresAt: new Date(Date.now() + 30 * 86400000),
        },
        include: { suggestion: true },
      });
    }
    if (attachment.processingStatus !== "STORED") {
      await this.deps.storage.upload(attachment.storagePath, bytes, mime);
      await prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          processingStatus: "STORED",
          expiresAt: new Date(Date.now() + 30 * 86400000),
        },
      });
    }
    const billing = this.deps.billing;
    if (billing) await billed(() => billing.check(h, "receipt"));
    let balance: number | null = null;
    if (this.deps.analyzer.analyzeStatement) {
      const choices = await householdChoices(h);
      const { statement } = await this.deps.analyzer.analyzeStatement(
        bytes,
        mime,
        event.caption || "",
        {
          today: event.referenceDate || today(),
          senderName: who.user.name,
          categories: choices.categories.map((c) => c.name),
        },
      );
      if (statement.kind === "CARD_STATEMENT" && statement.items.length) {
        if (billing)
          ({ balance } = await billed(() => billing.reserve(h, "statement")));
        const payload = await buildPayload(
          h,
          who.userId,
          statement,
          event.referenceDate || today(),
          attachment.id,
        );
        const row = await prisma.externalImport.upsert({
          where: {
            householdId_source_externalId: {
              householdId: h,
              source: "TELEGRAM",
              externalId: "telegram:" + event.id,
            },
          },
          create: {
            householdId: h,
            source: "TELEGRAM",
            externalId: "telegram:" + event.id,
            payload: payload as unknown as Prisma.InputJsonValue,
          },
          update: {},
        });
        await prisma.attachment.update({
          where: { id: attachment.id },
          data: { externalImportId: row.id },
        });
        await this.showImport(who, row.id);
        return this.lowCredit(event.chatId, balance);
      }
    }
    let charged = 0;
    if (billing)
      ({ charged, balance } = await billed(() =>
        billing.reserve(h, "receipt"),
      ));
    let analysis: Awaited<ReturnType<typeof this.deps.analyzer.analyze>>;
    try {
      analysis = await this.deps.analyzer.analyze(
        bytes,
        mime,
        event.caption || "",
      );
    } catch (e) {
      await billing
        ?.refund(h, charged, "Leitura do comprovante falhou")
        .catch(() => {});
      throw e;
    }
    const current = await identity(event.senderId);
    if (!current || current.userId !== who.userId)
      throw new IntegrationError("UNLINKED", "Telegram desconectado.");
    const s = await saveSuggestion(
      who.userId,
      h,
      attachment.id,
      event.id,
      analysis,
    );
    if (!(await this.quick(event, s))) await this.summary(event.senderId, s.id);
    await this.lowCredit(event.chatId, balance);
  }
  async lowCredit(chatId: string, balance: number | null) {
    if (!this.deps.billing) return;
    const notice = await credits.lowCreditNotice(balance);
    if (notice) await this.deps.telegram.send(chatId, notice).catch(() => {});
  }
  async process(event: Event) {
    if (event.kind === "start") {
      const who = event.linkHash
        ? await consumeLink(event)
        : await identity(event.senderId);
      await this.deps.telegram.send(
        event.chatId,
        who
          ? "Olá, " +
              who.user.name +
              "! 👋\n\nSeu Telegram está conectado ao Coflu.\n\n" +
              HELP +
              "\n\nQuando eu tiver certeza, lanço direto e te mostro quanto ainda sobra. Se ficar em dúvida, pergunto antes."
          : "Entre no Coflu e abra Configurações → Telegram → Conectar Telegram.",
      );
      return;
    }
    const who = await identity(event.senderId);
    if (!who || who.telegramChatId !== event.chatId)
      throw new IntegrationError(
        "UNLINKED",
        "Conecte seu Telegram nas Configurações.",
      );
    if (event.kind === "document") return this.document(event);
    if (event.kind === "callback") return this.callback(event);
    if (event.text === "/cancelar") {
      await prisma.telegramIdentity.update({
        where: { id: who.id },
        data: { editSuggestionId: null, editField: null, editExpiresAt: null },
      });
      await this.deps.telegram.send(event.chatId, "Edição cancelada.");
      return;
    }
    if (
      who.editSuggestionId &&
      who.editField &&
      who.editExpiresAt &&
      who.editExpiresAt > new Date()
    ) {
      const { s } = await ownedSuggestion(event.senderId, who.editSuggestionId);
      await editSuggestion(
        event.senderId,
        s.id,
        s.version,
        who.editField as EditField,
        event.text || "",
      );
      await prisma.telegramIdentity.update({
        where: { id: who.id },
        data: { editSuggestionId: null, editField: null, editExpiresAt: null },
      });
      return this.summary(event.senderId, s.id);
    }
    return this.text(event);
  }
  async text(event: Event) {
    const who = await identity(event.senderId);
    if (!who || who.telegramChatId !== event.chatId)
      throw new IntegrationError(
        "UNLINKED",
        "Conecte seu Telegram nas Configurações.",
      );
    const command = event.text?.trim().toLowerCase().split(/[\s@]/)[0];
    if (command === "/saldo" || command === "/orcamento") {
      const status = await budgetStatus(who.user.householdId);
      const lines = budgetLines(
        status,
        status.categories
          .filter((c) => c.budget != null || c.spent > 0)
          .map((c) => c.id),
      );
      await this.deps.telegram.send(
        event.chatId,
        lines.length
          ? "💰 Orçamento de " +
              monthLabel(status.month) +
              "\n\n" +
              lines.join("\n")
          : "Nenhum limite definido ainda. Abra o Coflu → Orçamento para definir quanto pode gastar em cada categoria.",
      );
      return;
    }
    if (command === "/ajuda" || command === "/help") {
      await this.deps.telegram.send(event.chatId, HELP);
      return;
    }
    if (!event.text?.trim() || event.text.trim().startsWith("/")) {
      await this.deps.telegram.send(event.chatId, HELP);
      return;
    }
    const existing = await prisma.transactionSuggestion.findUnique({
      where: { updateId: event.id },
    });
    if (existing) return this.summary(event.senderId, existing.id);
    if (!this.deps.analyzer.analyzeText)
      throw new IntegrationError(
        "TEXT_UNAVAILABLE",
        "A análise de texto está indisponível. Envie um comprovante.",
      );
    const choices = await householdChoices(who.user.householdId);
    const billing = this.deps.billing,
      h = who.user.householdId;
    const { charged, balance } = billing
      ? await billed(() => billing.reserve(h, "text"))
      : { charged: 0, balance: null };
    let analysis: TextAnalysis;
    try {
      analysis = await this.deps.analyzer.analyzeText(event.text, {
        today:
          event.referenceDate ||
          new Date().toLocaleDateString("en-CA", {
            timeZone: "America/Sao_Paulo",
          }),
        senderName: who.user.name,
        categories: choices.categories.map((c) => c.name),
      });
    } catch (e) {
      await billing
        ?.refund(h, charged, "Leitura do texto falhou")
        .catch(() => {});
      throw e;
    }
    // Conversa ou várias movimentações juntas: nada é lançado, então não gasta crédito.
    if (analysis.text.eventCount !== "SINGLE")
      await billing
        ?.refund(h, charged, "Mensagem sem lançamento")
        .catch(() => {});
    const current = await identity(event.senderId);
    if (!current || current.userId !== who.userId)
      throw new IntegrationError("UNLINKED", "Telegram desconectado.");
    if (analysis.text.eventCount !== "SINGLE") {
      await this.deps.telegram.send(
        event.chatId,
        analysis.text.eventCount === "MULTIPLE"
          ? "Identifiquei mais de uma movimentação. Envie uma por mensagem, incluindo valor e conta. Nada foi lançado."
          : "Descreva um lançamento com valor, conta e se já pagou/recebeu. Exemplo: Recebi 600 reais de freelancer hoje no cofrinho do PicPay. Nada foi lançado.",
      );
      return;
    }
    const s = await saveSuggestion(
      who.userId,
      who.user.householdId,
      null,
      event.id,
      analysis,
      { analysis, message: event.text },
    );
    if (!(await this.quick(event, s))) await this.summary(event.senderId, s.id);
    await this.lowCredit(event.chatId, balance);
  }
  /** Lança direto quando não há dúvida e mostra o saldo do envelope. */
  async quick(event: Event, s: TransactionSuggestion) {
    if (!this.deps.quickLaunch || !(await getSettings()).telegramQuickLaunch)
      return false;
    const result = await tryQuickConfirm(event.senderId, s);
    if (!result) return false;
    await this.deps.telegram.send(event.chatId, result.text, result.keyboard);
    return true;
  }
  async quickCallback(event: Event) {
    const [, action, id, value] = (event.token || "").split(":");
    if (action === "u") {
      const n = await undoQuick(event.senderId, id);
      await this.deps.telegram.send(
        event.chatId,
        n
          ? "↩️ Desfeito. Nada foi lançado."
          : "Este lançamento já tinha sido desfeito.",
      );
    } else if (action === "c") {
      await this.deps.telegram.send(
        event.chatId,
        "Escolha a categoria:",
        await quickCategories(event.senderId, id),
      );
    } else if (action === "s" && value) {
      const r = await recategorizeQuick(event.senderId, id, value);
      await this.deps.telegram.send(event.chatId, r.text, r.keyboard);
    }
  }
  async showImport(
    who: NonNullable<Awaited<ReturnType<typeof identity>>>,
    importId: string,
  ) {
    const { row, payload } = await ownedImport(
      who.user.householdId,
      who.userId,
      importId,
    );
    if (row.status !== "PENDENTE") {
      await this.deps.telegram.send(
        who.telegramChatId,
        row.status === "CONFIRMADA"
          ? "✅ Esta fatura já foi lançada."
          : "Esta importação foi descartada.",
      );
      return;
    }
    const p = await previewText(who.user.householdId, payload, today());
    await this.deps.telegram.send(
      who.telegramChatId,
      p.text,
      await previewKeyboard(
        who.user.householdId,
        row.id,
        p.ready,
        p.fresh,
        !payload.cardId,
      ),
    );
  }
  async importCallback(event: Event) {
    const who = await identity(event.senderId);
    if (!who)
      throw new IntegrationError(
        "UNLINKED",
        "Conecte seu Telegram nas Configurações.",
      );
    const [, action, id, value] = (event.token || "").split(":");
    const h = who.user.householdId;
    const { row, payload } = await ownedImport(h, who.userId, id);
    if (action === "ok") {
      await this.deps.telegram.send(
        event.chatId,
        await confirmImport(h, who.userId, row.id, today()),
      );
      return;
    }
    if (row.status !== "PENDENTE") return this.showImport(who, row.id);
    if (action === "no") {
      await prisma.externalImport.updateMany({
        where: { id: row.id, status: "PENDENTE" },
        data: { status: "DESCARTADA" },
      });
      await this.deps.telegram.send(
        event.chatId,
        "Importação descartada. Nada foi lançado.",
      );
    } else if (action === "list") {
      const text = listText(payload.items) || "Nenhuma compra encontrada.";
      for (let i = 0; i < text.length; i += 3800)
        await this.deps.telegram.send(event.chatId, text.slice(i, i + 3800));
    } else if (action === "cards") {
      await prisma.externalImport.update({
        where: { id: row.id },
        data: {
          payload: {
            ...payload,
            cardId: null,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return this.showImport(who, row.id);
    } else if (action === "card" && value) {
      const card = await prisma.creditCard.findFirst({
        where: { id: value, householdId: h, active: true },
      });
      if (!card) throw new IntegrationError("CARD", "Cartão indisponível.");
      const next: ImportPayload = { ...payload, cardId: card.id };
      await prisma.externalImport.update({
        where: { id: row.id },
        data: { payload: next as unknown as Prisma.InputJsonValue },
      });
      return this.showImport(who, row.id);
    }
  }
  async runOne(targetId?: string) {
    const owner = randomUUID();
    const job = await atomic(async (tx) => {
      // Chave constante, sem entrada externa. Um lease global mantém a ordem das edições e uploads.
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(72836152)");
      if (
        await tx.telegramUpdate.findFirst({
          where: { status: "PROCESSING", leaseUntil: { gt: new Date() } },
        })
      )
        return null;
      const row = await tx.telegramUpdate.findFirst({
        where: {
          ...(targetId ? { id: targetId } : {}),
          OR: [
            { status: "QUEUED", availableAt: { lte: new Date() } },
            { status: "PROCESSING", leaseUntil: { lte: new Date() } },
          ],
        },
        orderBy: { createdAt: "asc" },
      });
      if (!row) return null;
      return tx.telegramUpdate.update({
        where: { id: row.id },
        data: {
          status: "PROCESSING",
          leaseOwner: owner,
          leaseUntil: new Date(Date.now() + 5 * 60000),
          attempts: { increment: 1 },
        },
      });
    });
    if (!job) return false;
    const event = job.payload as unknown as Event;
    const heartbeat = setInterval(() => {
      void prisma.telegramUpdate
        .updateMany({
          where: { id: job.id, leaseOwner: owner, status: "PROCESSING" },
          data: { leaseUntil: new Date(Date.now() + 5 * 60000) },
        })
        .catch(() => {});
    }, 30000);
    try {
      await this.process(event);
      await prisma.telegramUpdate.updateMany({
        where: { id: job.id, leaseOwner: owner },
        data: {
          status: "DONE",
          payload: {},
          leaseOwner: null,
          leaseUntil: null,
        },
      });
    } catch (e) {
      const error = e instanceof IntegrationError ? e : null,
        retry = error?.retryable && job.attempts < 3;
      await prisma.telegramUpdate.updateMany({
        where: { id: job.id, leaseOwner: owner },
        data: {
          status: retry ? "QUEUED" : "FAILED",
          availableAt: new Date(Date.now() + job.attempts * 30000),
          lastError: error?.code || "PROCESSING_FAILED",
          leaseOwner: null,
          leaseUntil: null,
          ...(!retry ? { payload: {} } : {}),
        },
      });
      if (!retry) {
        const safeMessage =
          error?.message ||
          ((e as { statusCode?: number }).statusCode === 400
            ? (e as Error).message
            : "Não consegui concluir. Tente novamente ou gere uma nova sugestão.");
        await this.deps.telegram
          .send(event.chatId, safeMessage)
          .catch(() => {});
      }
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
  start() {
    if (this.timer || this.running) return;
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      this.running = true;
      try {
        await this.runOne();
      } catch {
        /* Fila persistida; não logar payloads financeiros. */
      } finally {
        this.running = false;
        if (!this.stopped) this.timer = setTimeout(tick, 1000);
      }
    };
    this.timer = setTimeout(tick, 0);
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running)
      await new Promise((resolve) => setTimeout(resolve, 50));
  }
  async cleanup() {
    await prisma.transactionSuggestion.updateMany({
      where: {
        status: { in: [...pendingStatuses] },
        expiresAt: { lt: new Date() },
      },
      data: { status: "EXPIRED" },
    });
    const attachments = await prisma.attachment.findMany({
      where: {
        expiresAt: { lt: new Date() },
        transactionId: null,
        processingStatus: { not: "DELETED" },
      },
      take: 50,
    });
    for (const a of attachments) {
      await this.deps.storage.remove(a.storagePath);
      await prisma.attachment.update({
        where: { id: a.id },
        data: { processingStatus: "DELETED" },
      });
    }
    await prisma.telegramCallback.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await prisma.telegramLinkToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
