import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const oldBrand = /nossa[ _-]?grana/i;
const read = (path:string) => readFileSync(path,"utf8");
test("marca: login, logo e dashboard apresentam exclusivamente Coflu",()=>{
  assert.match(read("apps/web/src/components/Shell.tsx"),/<span>Coflu<\/span>/);
  assert.match(read("apps/web/src/pages/SettingsLogin.tsx"),/Entrar no Coflu/);
  assert.match(read("apps/web/src/pages/Dashboard.tsx"),/<h1>Coflu!<\/h1>/);
});
test("marca: título, descrição, Open Graph e nomes de instalação são Coflu",()=>{
  const html=read("apps/web/index.html");
  assert.match(html,/<title>Coflu • Nossas finanças<\/title>/);
  for(const attribute of ['name="application-name"','name="apple-mobile-web-app-title"','property="og:title"','name="description"'])
    assert.ok(html.includes(attribute+' content="Coflu'));
  assert.ok(!oldBrand.test(html));
});
test("marca: fontes frontend, API, prompts e assets não apresentam marca anterior",()=>{
  function walk(dir:string){
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      const path=join(dir,entry.name);
      if(entry.isDirectory())walk(path);
      else if(/\.(ts|tsx|js|jsx|html|css|scss|svg|json|webmanifest)$/i.test(entry.name))
        assert.ok(!oldBrand.test(read(path)),path);
    }
  }
  for(const dir of ["apps/web/src","apps/web/public","apps/api/src","packages"])walk(dir);
});
test("marca: mensagens do Telegram e prompt de extração usam Coflu",()=>{
  const bot=read("apps/api/src/integrations/telegram/integration.ts");
  assert.ok(bot.includes("Seu Telegram está conectado ao Coflu."));
  assert.ok(bot.includes("Lançamento salvo no Coflu."));
  assert.ok(read("apps/api/src/integrations/telegram/analyzer.ts").includes("revisão humana no Coflu."));
});
test("marca: pacote, exportação CSV e documentação apresentam Coflu",()=>{
  assert.equal(JSON.parse(read("package.json")).name,"coflu");
  assert.match(read("apps/web/src/pages/TransactionsPage.tsx"),/a.download = "coflu-"/);
  assert.match(read("README.md"),/^# Coflu/m);
  assert.match(read("docs/design-system.md"),/^# Contrato visual Coflu/m);
});
