# Revoada

Um app para macOS que junta as suas contas de agentes de código (Claude Code, Codex, Gemini CLI, Grok) num lugar só: uma conversa, várias contas, e o trabalho continua quando uma delas bate no limite.

*A local macOS app that runs several Claude Code, Codex, Gemini CLI and Grok accounts side by side, rotates between them when one hits its usage limit, and carries the conversation along. Interface in Brazilian Portuguese.*

## O que faz

- **Várias contas por provedor.** Cada conta é um perfil com configuração isolada. O login é o do CLI oficial; a Revoada não copia token nem fala com a API por conta própria.
- **Conversa de verdade.** Mensagens, texto formatado, comandos com a saída, arquivos editados e o diff do que mudou, em vez da tela crua do terminal. O terminal de cada agente continua disponível.
- **Rodízio que leva a conversa.** Quando uma conta bate no limite, o pedido continua na próxima, com o histórico do que foi dito e feito. Vale também para trocar de agente à mão, até entre provedores.
- **Permissão por ação.** No modo "Pergunta antes", o agente para e mostra o comando ou o arquivo antes de agir. Você permite, permite sempre naquela conversa, ou nega. O que só lê roda direto, sem perguntar.
- **Consumo à vista.** Quanto cada conta já usou das janelas do provedor, e o rodízio começa pela mais folgada. Cada resposta mostra os tokens que gastou.
- **Revisão cruzada.** Uma conta de outro provedor lê o que o agente mudou, sem poder editar, e aponta defeitos na própria conversa. Um botão manda os achados de volta para o autor corrigir. Pode rodar sozinha a cada resposta que mexe em arquivo.
- **Acompanhar pelo celular.** Uma página leve, em outro aparelho da sua rede, para ver o que está rodando, permitir ou negar um pedido e parar um agente. Desligada por padrão.
- **Cérebro compartilhado.** Um cofre do [Obsidian](https://obsidian.md) que espelha a memória de cada agente e entrega as notas relevantes como contexto de cada pedido, para qualquer conta. Temas sensíveis (finanças, infraestrutura) ficam de fora.
- **Cópia isolada por tarefa.** Cada tarefa paralela pode rodar num `git worktree` próprio, que some sozinho quando o trabalho vira PR. Também acha e limpa os clones que os agentes deixam para trás.
- **Conversas dos outros programas.** O que o Claude Code e o Codex já guardaram na máquina aparece na lateral e continua na sessão original. Chamada avulsa de script (`claude -p`, `codex exec` com um pedido só) fica de fora.
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
| `safe.ts` | Decide se um comando só lê, para rodar sem perguntar no modo "Pergunta antes". |
| `remote.ts` | Acompanhamento pelo celular: a segunda porta, o código de acesso e a API reduzida. |
| `public/` | A página principal (`index.html`), o painel da barra de menus (`mini.html`) e a página do celular (`remoto.html`). |
| `desktop/` | A janela nativa em Swift: sobe o servidor, barra de menus, avisos e vigília. |

**Contas isoladas.** Cada conta extra é um diretório em `~/.revoada/profiles/<id>`, passado ao CLI pela variável que ele já entende (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`). A conta "padrão desta máquina" é a que o CLI usa fora do app.

**Conversa e rodízio.** Enquanto a conta é a mesma, cada resposta retoma a sessão nativa do agente. Quando a conta muda, a próxima recebe um resumo do que foi dito e feito na frente do pedido. O limite é detectado pela mensagem de erro do próprio CLI.

**Revisão cruzada.** O revisor recebe o pedido do usuário e o diff (numa cópia isolada, tudo desde que ela se separou da principal; arquivo novo fora do git entra inteiro) e roda em modo só leitura, numa sessão própria. A conta e a sessão nativa do autor não mudam. A escolha é outro provedor primeiro, porque outro modelo erra em lugares diferentes; sem outro pronto, outra conta do mesmo.

**Cérebro.** `Agentes/` e `Projetos/` no cofre são espelho (a origem manda, a sincronização sobrescreve). `Revoada/` são notas próprias, onde você ou qualquer agente pode escrever. A busca é local, por palavra (BM25); com um modelo de embeddings no Ollama passa a considerar também o significado.

## Segurança

A Revoada executa agentes que rodam comandos na sua máquina. Por isso:

- O servidor só escuta em `127.0.0.1` e recusa qualquer chamada cuja origem não seja a própria página.
- O acompanhamento pelo celular é a única coisa que escuta na rede, e só quando você liga. É outra porta (a do painel mais um), com uma API própria e pequena: ver conversas e limites, permitir ou negar, parar e, com uma segunda chave, escrever numa conversa que já existe. Criar conta, abrir terminal, mudar ajuste e ler o cérebro não existem ali. O acesso é por um código aleatório que vai no QR; errar oito vezes bloqueia o aparelho por dez minutos, e trocar o código derruba todos os pareados. **A conexão não é cifrada**: use na rede de casa ou pelo Tailscale, nunca em Wi-Fi público. Com a chave de escrever ligada, quem tiver o código manda pedidos aos seus agentes.
- Nenhum token ou credencial passa pelo app: a autenticação é toda dos CLIs.
- No modo "Pergunta antes" o agente não age sem sua resposta, com uma exceção que você pode desligar em Ajustes: o que só lê (listar, buscar, ver arquivo, consultar o git e o GitHub) roda direto. A regra é uma lista do que se sabe seguro, em `safe.ts`: redirecionamento para arquivo, substituição de comando, segundo plano e qualquer programa fora da lista continuam perguntando. Ler não tem limite de pasta, então um comando de leitura pode mostrar ao agente um arquivo sensível fora do projeto. Hoje só o Claude oferece isso; os outros caem para "Pode editar", com aviso na conversa.
- Notas de tema bloqueado não são copiadas para o cofre nem enviadas como contexto. O bloqueio vale para o que a Revoada envia; um agente com acesso a arquivos ainda pode ler a pasta de memória de outro.
- Usar várias contas pode ter regras próprias em cada provedor. Leia os termos de uso de cada um.

## Onde ficam os seus dados

Nada sai da máquina além do que cada CLI já envia ao próprio provedor.

| Caminho | Conteúdo |
| --- | --- |
| `~/.revoada/` | Contas, conversas, anexos, consumo, ajustes e o registro do app. |
| `~/revoada-cerebro/` | O cofre do cérebro. |
| `~/.revoada/worktrees/` | Cópias isoladas criadas para tarefas. |

Variáveis de ambiente: `REVOADA_HOME` (dados), `REVOADA_VAULT` (cofre), `REVOADA_PROJECTS` (pasta dos seus repositórios, padrão `~/git`), `PORT` e `REVOADA_REMOTE_PORT` (porta do celular, padrão `PORT` + 1).

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

`tests/flows.test.ts` sobe o servidor de verdade numa pasta de usuário descartável, com CLIs de mentira no `PATH` (`tests/stubs/`) que falam os mesmos protocolos dos reais. Cobre contas, conversa, rodízio, permissão, consumo, anexos, cérebro, cópias, importação, revisão cruzada e o acesso pelo celular (código, bloqueio e o que a porta não expõe). Não toca na sua pasta de usuário nem gasta conta.

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
- O celular não recebe aviso com a página fechada: notificação de navegador exige HTTPS, e a porta é HTTP.
- Reinstalar o app encerra as sessões de terminal abertas.

## Créditos

- Terminal embutido: [xterm.js](https://xtermjs.org) (MIT).
- A vigília foi inspirada no [Insomnia](https://github.com/krishhgg/Insomnia) (MIT), sem usar código dele.
- A revisão cruzada, o acompanhamento pelo celular e os tokens por resposta vieram de ideias do [open-code-review](https://github.com/alibaba/open-code-review), do [coucou](https://github.com/Louis-CFM/coucou) e do [cost-xray](https://github.com/tigerless-labs/cost-xray), sem usar código deles.
- QR do pareamento: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
- Tipografia: Geist (SIL Open Font License), carregada do Google Fonts.

Revoada não é afiliada à Anthropic, OpenAI, Google ou xAI. Os nomes dos produtos pertencem aos respectivos donos.

## Licença

[MIT](LICENSE).
