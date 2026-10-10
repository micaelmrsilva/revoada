// "Só lê?": decide se um comando de shell pode rodar sem perguntar no modo "Pergunta antes".
// É uma lista do que se sabe seguro, não uma lista do que se sabe perigoso: qualquer coisa que
// este arquivo não entende volta como "pergunte". Errar para o lado de perguntar custa um clique;
// errar para o outro lado roda um comando que o usuário não viu.
//
// O que conta como leitura: não escreve em arquivo, não apaga, não executa outro programa e não
// manda nada pela rede além de consulta (GET) ao GitHub pelo `gh`. Ler um arquivo sensível continua
// sendo leitura: o conteúdo vai para o agente, como iria pela ferramenta de ler arquivo.

type Word = { text: string; dollar: boolean };
type Token = Word | { op: string };

const MAX_CHARS = 6000;

// Quebra o comando em palavras e operadores, respeitando aspas. Devolve null quando encontra
// construção que não sabe avaliar (substituição de comando, redirecionamento para arquivo, etc.).
function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let cur: Word | null = null;
  const word = () => (cur ||= { text: "", dollar: false });
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  // $VAR, ${VAR} e ${VAR:-padrão} (padrão sem cara de opção). Fica de fora tudo que executa ou
  // monta texto por conta própria: $( ), $[ ], $'…', $"…". Devolve onde a expansão termina, ou -1.
  const expand = (i: number, w: Word) => {
    const next = src[i + 1];
    if (next === "(" || next === "[" || next === "'" || next === '"') return -1;
    w.dollar = true;
    if (next !== "{") { w.text += "$"; return i; }
    const end = src.indexOf("}", i);
    if (end < 0 || !/^[\w#@*?!]+(:?[-+]([\w.\/:][\w.\/:-]*)?)?$/.test(src.slice(i + 2, end))) return -1;
    w.text += src.slice(i, end + 1);
    return end;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\0" || ch === "`") return null;
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) return null;
      word().text += src.slice(i + 1, end);
      i = end;
    } else if (ch === '"') {
      const w = word();
      for (i++; ; i++) {
        if (i >= src.length) return null;
        const c = src[i];
        if (c === '"') break;
        if (c === "`") return null;
        if (c === "\\" && i + 1 < src.length) { w.text += src[++i]; continue; }
        if (c === "$") { if ((i = expand(i, w)) < 0) return null; continue; }
        w.text += c;
      }
    } else if (ch === "\\") {
      if (i + 1 >= src.length) return null;
      if (src[i + 1] === "\n") { i++; continue; }
      word().text += src[++i];
    } else if (ch === "$") {
      if ((i = expand(i, word())) < 0) return null;
    } else if (ch === " " || ch === "\t") flush();
    else if (ch === "\n" || ch === ";") { flush(); out.push({ op: ";" }); }
    else if (ch === "|") { flush(); if (src[i + 1] === "|") i++; else if (src[i + 1] === "&") return null; out.push({ op: ";" }); }
    else if (ch === "&") {
      if (src[i + 1] === "&") { flush(); i++; out.push({ op: ";" }); }
      else if (!cur && /^&>\/dev\/null(?=[\s;|&)]|$)/.test(src.slice(i, i + 12))) i += 10;
      else return null; // segundo plano
    } else if (ch === ">") {
      // só o descarte de saída e a junção de erro com saída; qualquer outro destino é escrita
      const fd = cur && /^[12]$/.test(cur.text) && !cur.dollar;
      const rest = src.slice(i);
      const m = rest.match(/^>\s*\/dev\/null(?=[\s;|&)]|$)/) || (fd ? rest.match(/^>&[12](?=[\s;|&)]|$)/) : null);
      if (!m || (cur && !fd)) return null;
      cur = null;
      i += m[0].length - 1;
    } else if (ch === "<") return null;
    else if (ch === "(" || ch === ")") { flush(); out.push({ op: ch }); }
    else word().text += ch;
  }
  flush();
  return out;
}

const flagsOnly = (args: Word[], ok: RegExp) => args.every((a) => ok.test(a.text));
const has = (args: Word[], bad: RegExp) => args.some((a) => bad.test(a.text));

// um script de sed que só substitui, imprime ou apaga linha: nada de `w arquivo` nem de `e`
function sedScript(s: string) {
  if (/^(\d+|\$)?(,(\d+|\$))?[pdq]$/.test(s) || /^\/(?:[^\/\\\n]|\\.)*\/[pd]$/.test(s)) return true;
  if (s[0] !== "s" || s.length < 4 || /[\w\s\\]/.test(s[1])) return false;
  const d = s[1], parts: string[] = [""];
  for (let i = 2; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) { parts[parts.length - 1] += s[i] + s[++i]; continue; }
    if (s[i] === "\n") return false;
    if (s[i] === d) parts.push(""); else parts[parts.length - 1] += s[i];
  }
  return parts.length === 3 && /^[gIip\d]*$/.test(parts[2]);
}
function sed(args: Word[]) {
  let script = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i].text;
    if (a === "-e") { if (!args[++i] || !sedScript(args[i].text)) return false; script = true; }
    else if (/^-[nEr]+$/.test(a)) continue;
    else if (a.startsWith("-")) return false; // -i edita o arquivo, -f lê script de fora
    else if (!script) { if (!sedScript(a)) return false; script = true; }
  }
  return script;
}

const GIT_READ = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files", "ls-tree", "blame", "describe", "shortlog", "cat-file", "merge-base", "grep", "rev-list", "name-rev", "show-ref", "for-each-ref", "whatchanged", "diff-tree", "count-objects"]);
function git(args: Word[]) {
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i].text;
    if (a === "--no-pager") continue;
    if (a === "-C" && args[i + 1]) { i++; continue; }
    break;
  }
  const sub = args[i]?.text, rest = args.slice(i + 1);
  if (!sub || has(rest, /^(--output(=|$)|-o$|--ext-diff$|--open-files-in-pager|-O)/)) return false;
  if (GIT_READ.has(sub)) return true;
  if (sub === "branch") return flagsOnly(rest, /^(-a|-r|-v|-vv|--list|--all|--remotes|--show-current|--no-color)$/);
  if (sub === "remote") return rest.length === 0 || (rest.length === 1 && /^(-v|show)$/.test(rest[0].text)) || (rest[0]?.text === "get-url" && rest.length === 2);
  if (sub === "tag") return flagsOnly(rest, /^(-l|--list|-n\d*)$/);
  if (sub === "stash") return rest[0]?.text === "list" || (rest[0]?.text === "show");
  if (sub === "config") return rest[0]?.text === "--get" && rest.length === 2;
  if (sub === "worktree") return rest.length === 1 && rest[0].text === "list";
  return false;
}

const GH_VIEW: Record<string, RegExp> = { repo: /^(view|list)$/, pr: /^(view|list|diff|status|checks)$/, issue: /^(view|list|status)$/, run: /^(view|list)$/, release: /^(view|list)$/, workflow: /^(view|list)$/, search: /^(repos|issues|prs|code|commits)$/, label: /^list$/ };
function gh(args: Word[]) {
  const [a, b] = [args[0]?.text, args[1]?.text];
  if (!a || has(args, /^(-w|--web)$/)) return false;
  if (a === "api") {
    // consulta: nada de método, campo ou corpo (qualquer um deles vira escrita) nem GraphQL
    let path = "";
    for (let i = 1; i < args.length; i++) {
      const t = args[i].text;
      if (/^(--jq|-q|--template|-t|-H|--header|--cache)$/.test(t)) { i++; continue; }
      if (/^(--paginate|--slurp|-i|--include|--silent|--verbose)$/.test(t) || /^(--jq|--template|--header|--cache)=/.test(t)) continue;
      if (t.startsWith("-") || path) return false;
      path = t;
    }
    return !!path && !/^\/?graphql\b/.test(path);
  }
  if (a === "auth") return b === "status" && args.length === 2; // --show-token entregaria o token ao agente
  return !!b && !!GH_VIEW[a]?.test(b);
}

// programas que só leem com qualquer argumento
const PLAIN = new Set(["cd", "echo", "printf", "pwd", "ls", "cat", "head", "tail", "wc", "cut", "tr", "grep", "egrep", "fgrep", "jq", "basename", "dirname", "realpath", "stat", "du", "df", "which", "type", "true", "false", "test", "[", "nl", "column", "diff", "cmp", "whoami", "uname", "id", "sw_vers", "nproc", "md5", "shasum", "sha256sum", "rev", "tac", "fold", "expand", "comm", "seq", "sleep"]);
const CHECKED: Record<string, (args: Word[]) => boolean> = {
  sed, git, gh,
  find: (a) => !has(a, /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/),
  sort: (a) => !has(a, /^(-o|--output)/) && !has(a, /^-[a-zA-Z]*o/),
  uniq: (a) => a.filter((x) => !x.text.startsWith("-")).length <= 1,
  base64: (a) => !has(a, /^(-o|--output)/),
  rg: (a) => !has(a, /^--(pre|pre-glob|hostname-bin)(=|$)/),
  date: (a) => flagsOnly(a, /^(\+.*|-u|-R|-I\w*)$/),
  hostname: (a) => a.length === 0,
  file: (a) => !has(a, /^(-[a-zA-Z]*C|--compile)/),
  tree: (a) => !has(a, /^(-o|--output)/),
  xxd: (a) => !has(a, /^-r/) && a.filter((x) => !x.text.startsWith("-")).length <= 1,
};

// palavras que o próprio shell entende: não servem de nome de função
const SHELL_WORDS = new Set(["eval", "exec", "source", "command", "builtin", "alias", "unalias", "unset", "export", "set", "trap", "kill", "read", "let", "local", "declare", "typeset", "readonly", "return", "exit", "shift", "wait", "fg", "bg", "jobs", "time", "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "select", "function", "in", "coproc", "noglob", "nocorrect", "repeat", "print", "emulate", "zmodload", "autoload", "setopt", "unsetopt", "pushd", "popd", "dirs", "history", "fc", "hash", "ulimit", "umask", "enable", "disable", "bindkey", "compdef", "zle", "sched", "times", "getopts", "mapfile", "readarray", "shopt", "complete", "caller", "suspend", "logout", "disown", "exec", "nohup"]);

export function readOnlyCommand(command: string): boolean {
  if (typeof command !== "string" || !command.trim() || command.length > MAX_CHARS) return false;
  const tokens = tokenize(command);
  if (!tokens) return false;

  // Comandos simples, um a um: todo comando do texto é conferido, não importa como estejam ligados.
  // A única forma de agrupar aceita é a definição de função `nome() { … }`.
  const cmds: Word[][] = [[]];
  const funcs = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ("op" in t) {
      if (t.op === ";") { cmds.push([]); continue; }
      // parêntese só serve para definir função; subshell e glob com código ficam de fora
      const cur = cmds[cmds.length - 1], close = tokens[i + 1], brace = tokens[i + 2];
      const name = cur.length === 1 && !cur[0].dollar ? cur[0].text : "";
      if (t.op !== "(" || !close || !("op" in close) || close.op !== ")" || !brace || "op" in brace || brace.text !== "{" || brace.dollar) return false;
      // o nome não pode ser de nada que já exista: se a definição não valer, a chamada tem que falhar,
      // nunca cair num programa de verdade
      if (!/^[A-Za-z_]\w*$/.test(name) || PLAIN.has(name) || CHECKED[name] || SHELL_WORDS.has(name) || Bun.which(name)) return false;
      funcs.add(name);
      cmds[cmds.length - 1] = [];
      i++;
      continue;
    }
    if ((t.text === "{" || t.text === "}") && !t.dollar) { cmds.push([]); continue; }
    cmds[cmds.length - 1].push(t);
  }

  for (const c of cmds) {
    if (!c.length) continue;
    const [head, ...args] = c;
    // o nome do programa é literal e sem caminho; atribuição (VAR=x cmd) não passa
    if (head.dollar || !/^[\w.\[-]+$/.test(head.text)) return false;
    // variável dentro de opção (`-$1`, `--x=$Y`) esconderia a opção de quem confere
    if (args.some((a) => a.dollar && a.text.startsWith("-"))) return false;
    if (funcs.has(head.text)) {
      // o que entra numa função vira $1, $2… lá dentro: palavra simples, sem cara de opção
      if (!args.every((a) => !a.dollar && /^[\w.\/:@%+=,~][\w.\/:@%+=,~-]*$/.test(a.text))) return false;
      continue;
    }
    if (PLAIN.has(head.text)) continue;
    const check = CHECKED[head.text];
    if (!check || !check(args)) return false;
  }
  return cmds.some((c) => c.length > 0);
}

// ferramentas do agente que só leem, com qualquer entrada
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "WebSearch"]);
export function readOnlyTool(tool: string, input: any): boolean {
  if (READ_TOOLS.has(tool)) return true;
  return tool === "Bash" && !input?.run_in_background && readOnlyCommand(String(input?.command ?? ""));
}
