# revoada

Painel local pra rodar várias contas de Claude, Codex, Gemini e Grok num ponto só.

```bash
bun install
bun start   # http://127.0.0.1:4777
```

- Cada conta é um perfil com diretório de config isolado em `~/.revoada/profiles/<id>`
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`). O login é o do CLI oficial.
- Campo de pedido: uma conta abre a sessão interativa do agente; várias respondem em paralelo.
- Rodízio: alvo por provedor usa a conta livre usada há mais tempo e troca sozinho se bater no limite.
- Cérebro (`brain.ts`): cofre do Obsidian em `~/revoada-cerebro` (ou `REVOADA_VAULT`). `Agentes/` e
  `Projetos/` espelham a memória de cada agente (a origem manda, a sincronização sobrescreve);
  `Revoada/` são as notas próprias. Busca BM25 local, sem modelo; os trechos relevantes entram
  como contexto do pedido.
- Conversas encerradas ficam em `~/.revoada/history`.
- O servidor só escuta em 127.0.0.1 e recusa chamadas de outra origem.
- Fora do contexto: temas (finanças, infra) e notas avulsas que nunca são enviadas aos provedores,
  em `~/.revoada/brain-rules.json`. Continuam no cofre e na busca local.
- Ensinar agentes: um bloco entre `<!-- revoada:cerebro:inicio/fim -->` no arquivo de instruções
  globais de cada conta (CLAUDE.md, AGENTS.md, GEMINI.md). Só o bloco é do painel; o original fica
  copiado em `<arquivo>.antes-da-revoada`.

## Testes

```bash
bun test
```

`tests/flows.test.ts` sobe o servidor de verdade numa pasta de usuário descartável, com CLIs de mentira no
PATH (`tests/stubs/codex` e `tests/stubs/claude` falam os mesmos protocolos dos reais), e exercita pela API:
contas, conversa, rodízio com histórico, retomada de sessão, permissão, consumo, título, anexos, cérebro
(bloqueio e contexto), ensino dos agentes, cópia isolada, classificação de clones e importação de histórico.
Não toca na sua pasta de usuário nem gasta conta de verdade. Rode antes de `bun run app:install`.

## App desktop (macOS)

```bash
bun run app:install   # monta dist/Revoada.app e copia para /Applications
```

`desktop/main.swift` é a janela nativa (WKWebView): sobe o servidor compilado que vai dentro do
bundle, espera responder e mostra a página. Sair do app encerra o servidor; fechar a janela não.
Se já houver um painel na porta 4777 (`bun start`), o app só se conecta a ele. Registro em
`~/.revoada/app.log`. A logo é `public/icon.svg` (ícone) e `public/logo.svg` (interface).
`desktop/status.swift` é a presença na barra de menus: número de agentes trabalhando, ponto vermelho
com conta no limite, menu com conversas, limites e logins, avisos do sistema e selo no Dock. Lê
`/api/state` a cada 2,5s; "trabalhando" = sessão que escreveu na tela nos últimos 5s ou disparo rodando.

## Clones
`clones.ts` acha cópias de repositório deixadas pelos agentes (clones lado a lado em `~/git` e
worktrees), mede e classifica. "Pode apagar" = nada que só exista ali. A limpeza automática (opcional)
só leva cópia limpa, com PR, sem sessão aberta e parada há mais de 1h. Tudo vai para a Lixeira do macOS.

## Conversas
`convos.ts` roda cada resposta no modo estruturado do CLI (`codex exec --json`, `claude -p --output-format
stream-json`, `gemini --output-format stream-json`) e traduz os eventos em itens (texto, comando, arquivos,
raciocínio). Mesma conta = retoma a sessão nativa; conta diferente (limite, rodízio, troca manual) = sessão
nova com o histórico da conversa na frente do pedido. Guardadas em `~/.revoada/convos`.

Cópia isolada: `git worktree` em `~/.revoada/worktrees/<repo>/<tarefa>`, branch `revoada/<tarefa>`. Sai
sozinha quando fica limpa e com tudo no remoto; volta do branch se a conversa continuar.

Cérebro: notas de tema bloqueado não são espelhadas no cofre. Busca por significado é opcional, via
Ollama local (`bge-m3`), e mistura com a busca por palavra.

App: ⌃⌥Espaço abre o pedido rápido; "Abrir ao iniciar o Mac" no menu Revoada. Para distribuir:
`SIGN_ID="Developer ID Application: ..." NOTARY_PROFILE=... bun run app:zip`.

## 1.2
- Modo "Pergunta antes": o Claude roda com `--permission-prompt-tool stdio` e cada pedido de permissão vira
  um cartão na conversa (permitir, sempre nesta conversa, negar). Codex e Gemini não têm isso no modo usado
  aqui e caem para "pode editar".
- Consumo: Claude informa as janelas de 5h e 7 dias em cada resposta; do Codex é lido do arquivo da sessão.
  O rodízio começa pela conta mais folgada. Guardado em `~/.revoada/usage.json`.
- Texto ao vivo no Claude (`--include-partial-messages`). Anexos em `~/.revoada/attachments`: imagem vai
  nativa para Claude e Codex; outros arquivos vão como caminho.
- Título automático pelo Claude Haiku depois da primeira resposta.
- `history.ts`: lista as sessões que o Claude Code e o Codex já guardaram e abre cada uma como conversa,
  ligada à sessão original (continuar retoma o mesmo id).
