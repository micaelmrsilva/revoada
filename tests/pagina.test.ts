// O script do painel é um arquivo só, com centenas de nomes soltos no mesmo escopo. Declarar duas vezes
// o mesmo nome derruba a página inteira no carregamento, e o teste de tela só diria "esperei demais".
// Aqui o erro aparece com nome e linha.
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

for (const file of ["index.html", "remoto.html", "mini.html"]) {
  test(`${file}: o script da página compila`, () => {
    const html = readFileSync(join(import.meta.dir, "../public", file), "utf8");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const code of scripts) expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(code)).not.toThrow();
  });
}
