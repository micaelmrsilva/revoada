# Revoada

Um app para macOS que junta as suas contas de agentes de código (Claude Code, Codex, Gemini CLI, Grok) num lugar só: uma conversa, várias contas, e o trabalho continua quando uma delas bate no limite.

*A local macOS app that runs several Claude Code, Codex, Gemini CLI and Grok accounts side by side, rotates between them when one hits its usage limit, and carries the conversation along. Interface in Brazilian Portuguese.*

## O que faz

- **Várias contas por provedor.** Cada conta é um perfil com configuração isolada. O login é o do CLI oficial; a Revoada não copia token nem fala com a API por conta própria.
- **Conversa de verdade.** Mensagens, texto formatado, comandos com a saída, arquivos editados e o diff do que mudou, em vez da tela crua do terminal. O terminal de cada agente continua disponível.
- **Rodízio que leva a conversa.** Quando uma conta bate no limite, o pedido continua na próxima, com o histórico do que foi dito e feito. Vale também para trocar de agente à mão, até entre provedores.
- **Permissão por ação.** No modo "Pergunta antes", o agente para e mostra o comando ou o arquivo antes de agir. Você permite, permite sempre naquela conversa, ou nega.
- **Consumo à vista.** Quanto cada conta já usou das janelas do provedor, e o rodízio começa pela mais folgada.
- **Cérebro compartilhado.** Um cofre do [Obsidian](https://obsidian.md) que espelha a memória de cada agente e entrega as notas relevantes como contexto de cada pedido, para qualquer conta. Temas sensíveis (finanças, infraestrutura) ficam de fora.
- **Cópia isolada por tarefa.** Cada tarefa paralela pode rodar num `git worktree` próprio, que some sozinho quando o trabalho vira PR. Também acha e limpa os clones que os agentes deixam para trás.
- **Conversas dos outros programas.** O que o Claude Code e o Codex já guardaram na máquina aparece na lateral e continua na sessão original.
- **Mac acordado enquanto os agentes trabalham**, e só enquanto trabalham. Com a tampa fechada também, depois de um passo de administrador.
- **Barra de menus.** Um painel com o que está rodando, limites e um campo de pedido rápido (`⌃⌥Espaço`).

## Requisitos

- macOS 13 ou mais novo, em Apple Silicon.
- [Bun](https://bun.sh) 1.4 ou mais novo.
- Ferramentas de linha de comando do Xcode (`xcode-select --install`), para montar o app.
- Pelo menos um dos CLIs instalado e logado: [Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli) ou Grok CLI.
- Opcionais: [GitHub CLI](https://cli.github.com) (estado dos PRs na limpeza de clones), Obsidian (para abrir o cofre) e [Ollama](https://ollama.com) (busca por significado no cérebro).

## Instalar

```bash
git clone <este repositório> revoada
cd revoada
bun install
bun run app:install
```

O último comando roda os testes, monta `Revoada.app` e copia para `/Applications`. O app é assinado só localmente: funciona na máquina em que foi montado. Para distribuir é preciso um certificado Developer ID (veja [Distribuir](#distribuir)).

Para rodar sem o app, direto no navegador:

```bash
bun start   # http://127.0.0.1:4777
```

## Como funciona

A Revoada é um servidor local em Bun com uma página, embrulhado numa janela nativa.

| Arquivo | Papel |
| --- | --- |
| `server.ts` | Servidor HTTP e WebSocket: contas, sessões de terminal, respostas em paralelo, ajustes. |
| `convos.ts` | Conversas. Roda cada resposta no modo estruturado do CLI e traduz os eventos em itens. Cuida da retomada de sessão, do rodízio e dos pedidos de permissão. |
| `brain.ts` | Cérebro: espelho da memória dos agentes num cofre, regras de bloqueio e busca. |
| `clones.ts` | Cópias de repositório: detecção, classificação e limpeza. |
| `history.ts` | Leitura do histórico do Claude Code e do Codex. |
| `public/` | A página principal (`index.html`) e o painel da barra de menus (`mini.html`). |
| `desktop/` | A janela nativa em Swift: sobe o servidor, barra de menus, avisos e vigília. |

**Contas isoladas.** Cada conta extra é um diretório em `~/.revoada/profiles/<id>`, passado ao CLI pela variável que ele já entende (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`). A conta "padrão desta máquina" é a que o CLI usa fora do app.

**Conversa e rodízio.** Enquanto a conta é a mesma, cada resposta retoma a sessão nativa do agente. Quando a conta muda, a próxima recebe um resumo do que foi dito e feito na frente do pedido. O limite é detectado pela mensagem de erro do próprio CLI.

**Cérebro.** `Agentes/` e `Projetos/` no cofre são espelho (a origem manda, a sincronização sobrescreve). `Revoada/` são notas próprias, onde você ou qualquer agente pode escrever. A busca é local, por palavra (BM25); com um modelo de embeddings no Ollama passa a considerar também o significado.

## Segurança

A Revoada executa agentes que rodam comandos na sua máquina. Por isso:

- O servidor só escuta em `127.0.0.1` e recusa qualquer chamada cuja origem não seja a própria página.
- Nenhum token ou credencial passa pelo app: a autenticação é toda dos CLIs.
- No modo "Pergunta antes" o agente não age sem sua resposta. Hoje só o Claude oferece isso; os outros caem para "Pode editar", com aviso na conversa.
- Notas de tema bloqueado não são copiadas para o cofre nem enviadas como contexto. O bloqueio vale para o que a Revoada envia; um agente com acesso a arquivos ainda pode ler a pasta de memória de outro.
- Usar várias contas pode ter regras próprias em cada provedor. Leia os termos de uso de cada um.

## Onde ficam os seus dados

Nada sai da máquina além do que cada CLI já envia ao próprio provedor.

| Caminho | Conteúdo |
| --- | --- |
| `~/.revoada/` | Contas, conversas, anexos, consumo, ajustes e o registro do app. |
| `~/revoada-cerebro/` | O cofre do cérebro. |
| `~/.revoada/worktrees/` | Cópias isoladas criadas para tarefas. |

Variáveis de ambiente: `REVOADA_HOME` (dados), `REVOADA_VAULT` (cofre), `REVOADA_PROJECTS` (pasta dos seus repositórios, padrão `~/git`) e `PORT`.

## Mac acordado com a tampa fechada

Com a tampa aberta, a Revoada já segura o Mac acordado enquanto há agente trabalhando, sem configuração. Com a tampa fechada o macOS exige desligar o sono do sistema, o que precisa de administrador:

```bash
scripts/vigilia-setup.sh
```

O script instala uma regra de `sudo` restrita a `pmset -a disablesleep 0` e `1`, e um vigia que religa o sono se o app morrer ou passar de 6 horas. A regra vale para qualquer programa rodando como o seu usuário. Para desfazer: `scripts/vigilia-setup.sh --remover`.

O Mac volta a dormir quando ninguém trabalha, com bateria abaixo de 15% ou em temperatura crítica. **Use em superfície ventilada, nunca dentro de mochila.**

## Testes

```bash
bun test
```

`tests/flows.test.ts` sobe o servidor de verdade numa pasta de usuário descartável, com CLIs de mentira no `PATH` (`tests/stubs/`) que falam os mesmos protocolos dos reais. Cobre contas, conversa, rodízio, permissão, consumo, anexos, cérebro, cópias e importação. Não toca na sua pasta de usuário nem gasta conta.

O que os testes não cobrem: a interface, a janela nativa e os CLIs reais. Se um provedor mudar o formato de saída, os testes continuam passando.

## Distribuir

```bash
SIGN_ID="Developer ID Application: Nome (TEAMID)" NOTARY_PROFILE=<perfil> bun run app:zip
```

Sem `SIGN_ID`, o zip abre em outro Mac por clique direito > Abrir.

## Limitações conhecidas

- Só macOS em Apple Silicon. O servidor roda em Linux (é onde os testes rodam), mas o app não.
- Interface só em português.
- Aprovação por ação e texto ao vivo funcionam só com o Claude.
- O Grok não tem modo estruturado conhecido: a resposta chega como texto único.
- Reinstalar o app encerra as sessões de terminal abertas.

## Créditos

- Terminal embutido: [xterm.js](https://xtermjs.org) (MIT).
- A vigília foi inspirada no [Insomnia](https://github.com/krishhgg/Insomnia) (MIT), sem usar código dele.
- Tipografia: Geist (SIL Open Font License), carregada do Google Fonts.

Revoada não é afiliada à Anthropic, OpenAI, Google ou xAI. Os nomes dos produtos pertencem aos respectivos donos.

## Licença

[MIT](LICENSE).
