// Markdown das respostas dos agentes → HTML. Usado pelo painel e pela página do celular.
// O texto vem de um modelo e pode ter sido influenciado pelo que ele leu, então nada do que
// chega vira marcação por conta própria: tudo passa por esc() e só o que este arquivo monta é HTML.
(function (root) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- dentro da linha ----------
  function inline(raw) {
    const keep = [];
    const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`;
    let t = String(raw ?? "").replace(/\u0000/g, "");
    // código primeiro: o que está entre crases não é negrito, link nem nada
    t = t.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_, _q, code) => hold(`<code>${esc(code.replace(/^ (.*) $/, "$1"))}</code>`));
    t = t.replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, (_, c) => hold(esc(c)));
    t = esc(t);
    const emph = (s) => s
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/g, "$1<b>$2</b>")
      .replace(/(^|[^\w*])\*(?=[^\s*])([^*]*?[^\s*]|[^\s*])\*(?![\w*])/g, "$1<i>$2</i>")
      .replace(/(^|[^\w_])_(?=[^\s_])([^_]*?[^\s_]|[^\s_])_(?![\w_])/g, "$1<i>$2</i>")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<s>$1</s>");
    // só endereço http(s) e e-mail viram link; javascript: e afins ficam como texto
    t = t.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label, url) => hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${emph(label)}</a>`));
    t = t.replace(/(^|[\s(])(https?:\/\/(?:(?!&quot;|&gt;|&lt;)[^\s\u0000])+)/g, (_, pre, found) => {
      const url = found.replace(/[.,;:!?)\]}'*_~]+$/, ""); // pontuação do fim da frase não é do endereço
      return pre + hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`) + found.slice(url.length);
    });
    t = emph(t);
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i] ?? "").replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i] ?? "");
  }

  // ---------- blocos ----------
  const FENCE = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>\s?(.*)$/;
  const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const width = (ws) => ws.replace(/\t/g, "    ").length;

  // corta a linha da tabela nas barras, sem contar as que estão escapadas ou dentro de código
  function cells(line) {
    const out = [];
    let cur = "", tick = false;
    const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
      else if (s[i] === "`") { tick = !tick; cur += s[i]; }
      else if (s[i] === "|" && !tick) { out.push(cur.trim()); cur = ""; }
      else cur += s[i];
    }
    out.push(cur.trim());
    return out;
  }

  function table(head, sep, rows) {
    const align = cells(sep).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
    const cols = cells(head);
    const at = (j) => (align[j] ? ` style="text-align:${align[j]}"` : "");
    return `<div class="tbl"><table><thead><tr>${cols.map((c, j) => `<th${at(j)}>${inline(c)}</th>`).join("")}</tr></thead><tbody>`
      + rows.map(cells).map((r) => `<tr>${cols.map((_, j) => `<td${at(j)}>${inline(r[j] ?? "")}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
  }

  function list(lines) {
    let html = "";
    const stack = []; // { indent, tag }
    const closeTo = (n) => { while (stack.length > n) html += `</li></${stack.pop().tag}>`; };
    for (const line of lines) {
      const m = line.match(ITEM);
      if (!m) { if (line.trim() && stack.length) html += `<br>${inline(line.trim())}`; continue; }
      const indent = width(m[1]), ordered = /\d/.test(m[2]), tag = ordered ? "ol" : "ul";
      while (stack.length > 1 && indent < stack[stack.length - 1].indent) closeTo(stack.length - 1);
      const top = stack[stack.length - 1];
      if (!top || indent >= top.indent + 2) {
        stack.push({ indent, tag });
        html += ordered && parseInt(m[2]) !== 1 ? `<ol start="${parseInt(m[2])}">` : `<${tag}>`;
      } else if (top.tag !== tag) {
        html += `</li></${stack.pop().tag}>`;
        stack.push({ indent, tag });
        html += ordered && parseInt(m[2]) !== 1 ? `<ol start="${parseInt(m[2])}">` : `<${tag}>`;
      } else html += "</li>";
      const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
      html += task ? `<li class="task"><span class="tk">${task[1] === " " ? "○" : "✓"}</span>${inline(task[2])}` : `<li>${inline(m[3])}`;
    }
    closeTo(0);
    return html;
  }

  function md(src, depth = 0) {
    const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
    let html = "", para = [];
    const flush = () => { if (para.length) { html += `<p>${para.map(inline).join("<br>")}</p>`; para = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(FENCE);
      if (fence) {
        flush();
        const body = [];
        // sem fechamento (texto ainda chegando): o resto é código
        for (i++; i < lines.length && !(lines[i].trim().startsWith(fence[1][0].repeat(3)) && /^\s*(`{3,}|~{3,})\s*$/.test(lines[i])); i++) body.push(lines[i]);
        const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), width(line.match(/^\s*/)[0]));
        html += `<pre>${fence[2] ? `<span class="lang">${esc(fence[2])}</span>` : ""}<code>${esc(body.map((l) => l.slice(Number.isFinite(pad) ? pad : 0)).join("\n"))}</code></pre>`;
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      const h = line.match(HEADING);
      if (h) { flush(); const n = Math.min(h[1].length + 1, 4); html += `<h${n}>${inline(h[2])}</h${n}>`; continue; }
      if (RULE.test(line)) { flush(); html += "<hr>"; continue; }
      if (QUOTE.test(line) && depth < 4) {
        flush();
        const body = [];
        for (; i < lines.length && QUOTE.test(lines[i]); i++) body.push(lines[i].match(QUOTE)[1]);
        i--;
        html += `<blockquote>${md(body.join("\n"), depth + 1)}</blockquote>`;
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-") && cells(lines[i + 1]).length === cells(line).length) {
        flush();
        const rows = [];
        let j = i + 2;
        for (; j < lines.length && lines[j].trim() && lines[j].includes("|"); j++) rows.push(lines[j]);
        html += table(line, lines[i + 1], rows);
        i = j - 1;
        continue;
      }
      if (ITEM.test(line)) {
        flush();
        const body = [];
        for (; i < lines.length; i++) {
          const l = lines[i];
          if (ITEM.test(l) && !RULE.test(l)) { body.push(l); continue; }
          if (FENCE.test(l)) break;
          if (l.trim() && /^\s{2,}/.test(l)) { body.push(l); continue; }
          // linha em branco só continua a lista se o que vem depois ainda é item
          if (!l.trim() && i + 1 < lines.length && (ITEM.test(lines[i + 1]) && !RULE.test(lines[i + 1]))) continue;
          break;
        }
        i--;
        html += list(body);
        continue;
      }
      para.push(line.trim());
    }
    flush();
    return html;
  }

  root.md = md;
  root.mdInline = inline;
})(typeof window !== "undefined" ? window : globalThis);
