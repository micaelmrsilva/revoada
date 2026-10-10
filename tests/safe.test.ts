// O que roda sem perguntar no modo "Pergunta antes". A segunda lista importa mais que a primeira:
// cada linha dela é um jeito de esconder escrita ou execução dentro de um comando com cara de leitura.
import { expect, test } from "bun:test";
import { readOnlyCommand, readOnlyTool } from "../safe";

const LEITURA = [
  "ls -la",
  "cat package.json | head -20",
  "cd /tmp; ls",
  "grep -rn 'foo(bar)' src | wc -l",
  "git status && git log --oneline -5",
  "git -C ../outro diff HEAD~1 --stat",
  "git branch -a",
  "find . -name '*.ts' -newer package.json",
  "sed -n '1,20p' server.ts",
  "sed -e 's/<[^>]*>//g' README.md",
  "gh api repos/a/b/readme --jq .content | base64 -d | head -c 3000",
  "gh pr view 12 --json title",
  "ls nada 2>/dev/null; echo fim",
  "cat a.txt 2>&1 | sort | uniq -c",
  "echo \"total: $HOME\"",
  // o comando de verdade que motivou isto: função local, só leitura, chamada com palavras simples
  `cd /tmp; rd(){ echo; echo "================== $1"; gh api repos/$1/readme --jq .content | base64 -d | sed -e 's/<[^>]*>//g' | grep -v '^\\s*$' | head -c \${2:-3000}; }
rd TryCaspian/caspian-sdk 4500
echo; echo "--- caspian tree (whatsapp)"; gh api "repos/TryCaspian/caspian-sdk/git/trees/HEAD?recursive=1" --jq '.tree[].path' | grep -i -E 'whatsapp|wa_|channel' | head -40
rd yetone/magpie 2500`,
];

const PERGUNTA = [
  "", "rm -rf x", "touch feito.txt", "npm install", "curl https://exemplo.dev", "bun test", "node -e 1", "python3 x.py",
  // escrita por redirecionamento
  "echo oi > a.txt", "cat a >> b", "ls 2> erro.txt", "echo x >/dev/nullo", "cat < a.txt", "cat <<EOF\nx\nEOF", "ls &>saida",
  // execução escondida
  "echo $(rm -rf x)", "echo `rm x`", "ls; (rm x)", "cat <(rm x)", "ls & rm x", "echo \"$(rm x)\"", "echo $'\\x2ddelete'",
  "X=1 ls", "/bin/ls", "./ls", "$CMD x", "eval ls", "xargs rm", "env", "command ls", "time ls", "ls |& tee x",
  // opção que transforma leitura em escrita ou execução
  "find . -delete", "find . -exec rm {} +", "find . -fprint x", "sed -i 's/a/b/' x", "sed -f s.sed x", "sed 's/a/b/w saida' x", "sed 's/a/b/e' x", "sed -e '1,3w x' y",
  "sort -o x y", "sort --output=x y", "uniq a b", "base64 -o x y", "rg --pre cat x", "tree -o x", "file -C -m x", "date 010100002030", "hostname novo",
  "git push", "git commit -m x", "git checkout .", "git -c core.pager=rm log", "git log --output=x", "git grep -Oless x", "git branch nova", "git tag v1", "git stash", "git config user.name x",
  "gh api -X DELETE repos/a/b", "gh api repos/a/b -f x=1", "gh api graphql --jq .", "gh api repos/a/b --input x", "gh pr create", "gh pr merge 1", "gh repo delete a/b", "gh auth status --show-token", "gh pr view --web",
  // função: variável virando opção, argumento com cara de opção, nome que já é programa
  "f(){ find . $1; }; f -delete",
  "f(){ sed -$1 's/a/b/' x; }; f i",
  "f(){ gh api repos/$1; }; f 'a -X DELETE /repos/a/b'",
  "f(){ find . ${1:--delete}; }; f",
  "f(){ find . \"${1:--delete}\"; }; f",
  "f(){ ls; }; g(){ f \"$@\"; }; g x",
  "rm(){ echo; }; rm x",
  "false && rm(){ echo; }; rm x",
  "eval(){ echo; }; eval x",
  "f() rm x",
  "ls *(e:'rm x':)",
  "x".repeat(7000),
];

test("comando que só lê passa sem perguntar", () => { for (const c of LEITURA) expect([c, readOnlyCommand(c)]).toEqual([c, true]); });
test("qualquer coisa além de leitura continua perguntando", () => { for (const c of PERGUNTA) expect([c, readOnlyCommand(c)]).toEqual([c, false]); });
test("ferramentas: ler passa, editar e buscar endereço perguntam", () => {
  expect(readOnlyTool("Read", { file_path: "/x" })).toBe(true);
  expect(readOnlyTool("Grep", { pattern: "x" })).toBe(true);
  expect(readOnlyTool("Bash", { command: "ls" })).toBe(true);
  expect(readOnlyTool("Bash", { command: "ls", run_in_background: true })).toBe(false);
  for (const t of ["Edit", "Write", "WebFetch", "Task", "NotebookEdit"]) expect(readOnlyTool(t, {})).toBe(false);
});
