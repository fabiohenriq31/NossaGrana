import "dotenv/config";
import { chromium, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { TelegramIntegration } from "../apps/api/src/integrations/telegram/integration.ts";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const prisma=new PrismaClient(), h="coflu-brand-qa-"+randomUUID(), email=h+"@example.test", password=randomUUID();
const sender=String(Math.floor(1e12+Math.random()*1e12));
const browser=await chromium.launch({channel:"chrome",headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:"pt-BR"});
const page=await context.newPage(),errors=[],captures=[],base="http://127.0.0.1:5173";
const oldBrand=/nossa[ _-]?grana/i;
page.on("pageerror",e=>errors.push(e.message));
page.on("response",r=>{if(r.status()>=500)errors.push("HTTP "+r.status()+" "+new URL(r.url()).pathname);});
async function capture(name){
  await expect(page).toHaveTitle("Coflu • Nossas finanças");
  expect(oldBrand.test(await page.locator("body").innerText())).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:"docs/screenshots/coflu-"+name+".png",fullPage:true});
  captures.push(name);
}
try {
  await mkdir("docs/screenshots",{recursive:true});
  await prisma.household.create({data:{id:h,name:"QA identidade visual"}});
  const user=await prisma.user.create({data:{householdId:h,name:"Fábio",email,passwordHash:await bcrypt.hash(password,4)}});
  await page.goto(base);
  await expect(page.locator(".login-card .logo")).toHaveText("Coflu");
  await capture("login-desktop");
  await page.setViewportSize({width:390,height:844});
  await capture("login-mobile");
  await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel("E-mail",{exact:true}).fill(email);
  await page.getByLabel("Senha",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Entrar no Coflu",exact:true}).click();
  await expect(page.locator(".desktop-dashboard h1")).toBeVisible();
  await expect(page.locator(".sidebar .logo")).toHaveText("Coflu");
  await capture("dashboard-desktop");
  await page.goto(base+"/configuracoes");
  await expect(page.getByRole("heading",{name:"Configurações",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Conectar Telegram",exact:true})).toBeVisible();
  await capture("settings-telegram-desktop");
  await page.getByRole("main").getByRole("button",{name:"Claro",exact:true}).click();
  await expect(page.locator("html")).toHaveClass("light");
  await capture("settings-telegram-light");
  await page.setViewportSize({width:390,height:844});
  await capture("settings-telegram-mobile-light");
  await page.getByRole("main").getByRole("button",{name:"Escuro",exact:true}).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await capture("settings-telegram-mobile-dark");
  await page.goto(base);
  await expect(page.getByRole("heading",{name:"Coflu!",exact:true})).toBeVisible();
  await capture("dashboard-mobile");
  const more=page.getByRole("navigation",{name:"Navegação mobile"}).getByRole("button",{name:"Mais",exact:true});
  if(await more.isVisible()){await more.click();await capture("mobile-menu");}
  await prisma.telegramIdentity.create({data:{userId:user.id,telegramUserId:sender,telegramChatId:sender}});
  const sent=[];
  const integration=new TelegramIntegration({
    telegram:{me:async()=>({username:"unused"}),send:async(_chat,text)=>{sent.push(text);},answer:async()=>{},download:async()=>{throw new Error("Não previsto neste QA");}},
    storage:{upload:async()=>{},signedDownloadUrl:async()=>"",remove:async()=>{}},
    analyzer:{analyze:async()=>{throw new Error("Não previsto neste QA");}},
  });
  await integration.process({id:"coflu-brand-start",senderId:sender,chatId:sender,kind:"start"});
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("Seu Telegram está conectado ao Coflu.");
  expect(oldBrand.test(sent[0])).toBe(false);
  expect(errors).toEqual([]);
  const result={passed:true,captures,title:"Coflu • Nossas finanças",telegramGreeting:true,consoleErrors:errors,externalMessagesSent:false};
  await writeFile("docs/coflu-brand-verification.json",JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{
  await context.close();await browser.close();
  await prisma.user.deleteMany({where:{householdId:h}});
  await prisma.household.deleteMany({where:{id:h}});
  await prisma.$disconnect();
}
