// Formatação das respostas. O texto vem de um modelo: além de ficar legível, nada dele pode virar
// marcação ou script por conta própria.
import { expect, test } from "bun:test";
import "../public/md.js";
const md = (globalThis as any).md as (s: string) => string;

test("tabela vira tabela", () => {
  const h = md("Quase.\n\n| Conta | Registrados (de 500) |\n| --- | --- |\n| Ronaldo (AraraHQ) | 496 |\n| Oka | 300, criando agora |\n\n- **Os que faltam** quase todos existem.");
  expect(h).toContain("<p>Quase.</p>");
  expect(h).toContain("<th>Conta</th>");
  expect(h).toContain("<td>Ronaldo (AraraHQ)</td><td>496</td>");
  expect(h).toContain("<td>300, criando agora</td>");
  expect(h).toContain("<ul><li><b>Os que faltam</b> quase todos existem.</li></ul>");
  expect(md("| a | b |\n|:-:|--:|\n| x | y |")).toContain('<th style="text-align:center">a</th><th style="text-align:right">b</th>');
  // barra dentro de código ou escapada não corta a célula; linha solta com barra não é tabela
  expect(md("| cmd | o que faz |\n|---|---|\n| `a | b` | junta \\| filtra |")).toContain("<td><code>a | b</code></td><td>junta | filtra</td>");
  expect(md("use a | b para juntar")).toBe("<p>use a | b para juntar</p>");
});

test("listas aninhadas, numeradas e de tarefas", () => {
  expect(md("- um\n  - dentro\n  - outro\n- dois")).toBe("<ul><li>um<ul><li>dentro</li><li>outro</li></ul></li><li>dois</li></ul>");
  expect(md("3. três\n4. quatro")).toBe('<ol start="3"><li>três</li><li>quatro</li></ol>');
  expect(md("1. a\n\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
  expect(md("- item\n  continua aqui")).toBe("<ul><li>item<br>continua aqui</li></ul>");
  expect(md("- [x] feito\n- [ ] falta")).toContain('<li class="task"><span class="tk">✓</span>feito</li>');
  expect(md("texto\n- a\n\nfim")).toBe("<p>texto</p><ul><li>a</li></ul><p>fim</p>");
});

test("títulos, citação, régua, quebra de linha e código", () => {
  expect(md("# A\n## B\n### C")).toBe("<h2>A</h2><h3>B</h3><h4>C</h4>");
  expect(md("> nota\n> segue")).toBe("<blockquote><p>nota<br>segue</p></blockquote>");
  expect(md("a\n\n---\n\nb")).toBe("<p>a</p><hr><p>b</p>");
  expect(md("linha um\nlinha dois")).toBe("<p>linha um<br>linha dois</p>");
  expect(md("```bash\nls | head\n```")).toBe('<pre><span class="lang">bash</span><code>ls | head</code></pre>');
  expect(md("```\nsem fim")).toBe("<pre><code>sem fim</code></pre>"); // texto ainda chegando
  expect(md("antes\n```\n**não é negrito**\n```\ndepois")).toContain("<code>**não é negrito**</code>");
});

test("dentro da linha: código, negrito, itálico, riscado e links", () => {
  expect(md("**forte** e *leve* e ~~fora~~ e `x*y*z`")).toBe("<p><b>forte</b> e <i>leve</i> e <s>fora</s> e <code>x*y*z</code></p>");
  expect(md("incident_templates_recusados_meta e 2 * 3 * 4")).toBe("<p>incident_templates_recusados_meta e 2 * 3 * 4</p>");
  expect(md("[site](https://exemplo.dev/a_b_c)")).toBe('<p><a href="https://exemplo.dev/a_b_c" target="_blank" rel="noopener noreferrer">site</a></p>');
  expect(md("veja https://exemplo.dev/x_y.")).toBe('<p>veja <a href="https://exemplo.dev/x_y" target="_blank" rel="noopener noreferrer">https://exemplo.dev/x_y</a>.</p>');
  expect(md("\\*literal\\*")).toBe("<p>*literal*</p>");
});

test("nada do texto vira marcação por conta própria", () => {
  for (const evil of [
    "<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "[x](javascript:alert(1))", "[x](data:text/html,<script>1</script>)",
    '[x](https://a.dev/"onmouseover="alert(1))', "`<b>oi</b>`", "```\n</code></pre><script>1</script>\n```", "| <script>1</script> |\n|---|\n| <img onerror=1> |",
    "- <svg onload=1>", "> <iframe src=x>", "# <a href=javascript:1>t</a>", 'https://a.dev/"><script>1</script>', "\u00000\u0000 <b>",
  ]) {
    const h = md(evil);
    expect([evil, /<(?!\/?(?:p|br|b|i|s|a|code|pre|span|ul|ol|li|h[2-4]|hr|blockquote|div|table|thead|tbody|tr|th|td)\b)/i.test(h)]).toEqual([evil, false]);
    expect([evil, /\son\w+\s*=|javascript:|data:text/i.test(h.replace(/&[a-z]+;/g, "").replace(/>[^<]*</g, "><"))]).toEqual([evil, false]);
  }
  // o único atributo que vem do texto é o href, e só com http(s) ou mailto
  expect(md('[x](https://a.dev/"onmouseover="alert(1))')).toContain('href="https://a.dev/&quot;onmouseover=&quot;alert(1"');
});
