# Revoada

Um app para macOS que junta as suas contas de agentes de código (Claude Code, Codex, Gemini CLI, Grok) num lugar só: uma conversa, várias contas, e o trabalho continua quando uma delas bate no limite.

*A local macOS app that runs several Claude Code, Codex, Gemini CLI and Grok accounts side by side, rotates between them when one hits its usage limit, and carries the conversation along. Interface in Brazilian Portuguese.*

## O que faz

- **Várias contas por provedor.** Cada conta é um perfil com configuração isolada. O login é o do CLI oficial; a Revoada não copia token nem fala com a API por conta própria.
- **Conversa de verdade.** Mensagens, texto formatado, comandos com a saída, arquivos editados e o diff do que mudou, em vez da tela crua do terminal. A resposta chega ao vivo, e o que você escrever enquanto o agente trabalha entra na fila e segue sozinho quando ele termina. O terminal de cada agente continua disponível.
- **Modelo e esforço por conversa.** Escolhidos no campo de pedido e passados ao CLI de cada provedor. Cada resposta mostra o modelo que respondeu.
- **Uso à vista.** Um anel no campo abre a janela de contexto da conversa e os limites da conta, com a hora em que renovam.
- **Copiar, editar e tentar de novo.** Editar uma mensagem sua volta a conversa àquele ponto; tentar de novo refaz a última resposta.
- **Quadro de tarefas.** Despeje as tarefas (uma por linha) e cada cartão vira um agente numa cópia própria do repositório. O cartão vai sozinho para "Revisar" quando o agente termina, depois de outra conta revisar o que ele mexeu.
- **Plano em arquivo.** Em tarefa longa, o agente mantém um plano em markdown, marca os passos e continua dele se a conversa for cortada ou trocar de conta.
- **Busca no conteúdo.** A busca da lateral procura no que foi dito dentro das conversas, as daqui e as dos outros programas.
- **Modelo automático.** A Revoada lê o pedido e escolhe o porte do modelo: consulta rápida no mais barato, trabalho pesado no mais forte.
- **Aviso sonoro.** Um som quando um agente termina um trabalho demorado e outro quando ele precisa de você.
- **Rodízio que leva a conversa.** Quando uma conta bate no limite, o pedido continua na próxima, com o histórico do que foi dito e feito. Vale também para trocar de agente à mão, até entre provedores.
- **Permissão por ação.** No modo "Pergunta antes", o agente para e mostra o comando ou o arquivo antes de agir. Você permite, permite sempre naquela conversa, ou nega. O que só lê roda direto, sem perguntar.
- **Consumo à vista.** Quanto cada conta já usou das janelas do provedor, e o rodízio começa pela mais folgada. Cada resposta mostra os tokens que gastou.
- **Revisão cruzada.** Uma conta de outro provedor lê o que o agente mudou, sem poder editar, e aponta defeitos na própria conversa. Um botão manda os achados de volta para o autor corrigir. Pode rodar sozinha a cada resposta que mexe em arquivo.
- **Supervisor.** Você descreve um trabalho grande, um agente divide em tarefas independentes, você aprova o plano, cada tarefa roda numa cópia isolada em contas diferentes, outra conta revisa e no fim um agente junta os branches.
- **Pedidos agendados.** "Roda isso às 3h" ou "toda segunda às 9h": na hora marcada vira uma conversa nova.
- **Skills e MCP em todas as contas.** O que está instalado na conta padrão passa a valer nas outras, sem instalar conta por conta.
- **Sugestão do próximo pedido.** Quando o agente termina, o campo oferece a próxima mensagem provável: Tab aceita, Enter envia.
- **Raio-x do gasto.** Clicando nos tokens de uma resposta: quanto foi entrada, cache e saída, e quanto disso a própria Revoada pôs no pedido (seu texto, cérebro, histórico da troca de conta).
- **Auditoria de segurança.** Um segundo tipo de revisão, com roteiro próprio (por onde entra dado de fora, onde ele chega, o que dá para explorar). Sem mudança pendente, audita o projeto inteiro.
- **Arrumação do cérebro.** Aponta nota vazia, cópia idêntica, notas parecidas e notas paradas; arquiva sozinha as duas primeiras, se você ligar.
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
| `missions.ts` | Supervisor: plano, aprovação, tarefas em paralelo, revisão e junção. |
| `schedule.ts` | Pedidos agendados: o relógio e a regra de hora perdida. |
| `tools.ts` | Skills e servidores MCP da conta padrão nas outras contas. |
| `safe.ts` | Decide se um comando só lê, para rodar sem perguntar no modo "Pergunta antes". |
| `board.ts` | Quadro de tarefas: cartões, colunas e o que anda sozinho. |
| `route.ts` | Modelo automático: as regras que dão o porte de um pedido. |
| `remote.ts` | Acompanhamento pelo celular: a segunda porta, o código de acesso e a API reduzida. |
| `public/` | A página principal (`index.html`), o painel da barra de menus (`mini.html`) a página do celular (`remoto.html`), o markdown das respostas (`md.js`) e a conversa ao vivo (`sync.js`). |
| `desktop/` | A janela nativa em Swift: sobe o servidor, barra de menus, avisos e vigília. |

**Contas isoladas.** Cada conta extra é um diretório em `~/.revoada/profiles/<id>`, passado ao CLI pela variável que ele já entende (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`). A conta "padrão desta máquina" é a que o CLI usa fora do app.

**Conversa e rodízio.** Enquanto a conta é a mesma, cada resposta retoma a sessão nativa do agente. Quando a conta muda, a próxima recebe um resumo do que foi dito e feito na frente do pedido. O limite é detectado pela mensagem de erro do próprio CLI.

**Supervisor.** O planejador roda em modo só leitura e devolve as tarefas num bloco JSON; nada é executado antes de você aprovar. Cada tarefa é uma conversa comum, numa cópia isolada (`git worktree`), revezando as contas escolhidas. A que mexe em arquivo passa por revisão de outra conta antes de contar como pronta. "Juntar os branches" abre mais uma conversa, numa cópia nova, que faz o merge de cada branch e roda os testes. São no máximo cinco tarefas por pedido.

**Pedidos agendados.** O relógio só anda com a Revoada aberta e o Mac acordado: ela não acorda a máquina. Hora perdida por até 6 horas roda quando o Mac volta; perdida por mais que isso é pulada e fica anotada. Pedido agendado no modo "Pergunta antes" roda como "Pode editar", porque não há ninguém para responder.

**Skills e MCP.** A conta padrão de cada provedor é a fonte. Skill entra nas outras contas como atalho (symlink) para a pasta original; a Revoada anota os atalhos que criou e só mexe neles, nunca numa pasta que a conta já tinha. Servidor MCP não é copiado para dentro do perfil: vai como argumento em cada execução (`--mcp-config` no Claude, `-c mcp_servers…` no Codex). Gemini e Grok recebem as skills, não os servidores MCP.

**Conversa ao vivo.** Com a conversa aberta, a página mantém uma conexão (`/api/convos/<id>/stream`, Server-Sent Events) e o servidor avisa a cada mudança. O primeiro aviso leva a conversa inteira; os seguintes, só os itens que mudaram. Se a conexão cai, o navegador religa e recebe tudo de novo. A página do celular ainda consulta de tempo em tempo.

**Modelo automático.** A escolha é feita por regras em `route.ts`, sem chamar modelo nenhum para decidir: palavras de trabalho pesado (refatorar, investigar, auditar, "por que") ou pedido longo vão no modelo mais forte; pergunta curta ou gesto único (rodar os testes, fazer o commit) no mais barato; o resto no do meio. Só o seu texto conta, não o que a Revoada põe em volta. Quando a regra erra, "Tentar de novo" com o modelo escolhido à mão resolve.

**Plano em arquivo.** O arquivo fica em `~/.revoada/plans/`, fora do repositório. As instruções vão uma vez por sessão do agente; sessão nova (troca de conta, tentar de novo) recebe o plano como está.

**Editar e tentar de novo.** A conversa é cortada na mensagem escolhida e ela é mandada outra vez. Nenhum CLI desfaz um trecho da própria sessão, então o agente começa uma sessão nova com o histórico do que ficou. Arquivos que a resposta descartada já tinha mexido continuam como estão.

**Revisão cruzada.** O revisor recebe o pedido do usuário e o diff (numa cópia isolada, tudo desde que ela se separou da principal; arquivo novo fora do git entra inteiro) e roda em modo só leitura, numa sessão própria. A conta e a sessão nativa do autor não mudam. A escolha é outro provedor primeiro, porque outro modelo erra em lugares diferentes; sem outro pronto, outra conta do mesmo.

**Cérebro.** `Agentes/` e `Projetos/` no cofre são espelho (a origem manda, a sincronização sobrescreve). `Revoada/` são notas próprias, onde você ou qualquer agente pode escrever. A busca é local, por palavra (BM25); com um modelo de embeddings no Ollama passa a considerar também o significado.

## Segurança

A Revoada executa agentes que rodam comandos na sua máquina. Por isso:

- O servidor só escuta em `127.0.0.1` e recusa qualquer chamada cuja origem não seja a própria página.
- O acompanhamento pelo celular é a única coisa que escuta na rede, e só quando você liga. É outra porta (a do painel mais um), com uma API própria e pequena: ver conversas e limites, permitir ou negar, parar e, com uma segunda chave, escrever numa conversa que já existe. Criar conta, abrir terminal, mudar ajuste e ler o cérebro não existem ali. O acesso é por um código aleatório que vai no QR; errar oito vezes bloqueia o aparelho por dez minutos, e trocar o código derruba todos os pareados. **A conexão não é cifrada**: use na rede de casa ou pelo Tailscale, nunca em Wi-Fi público. Com a chave de escrever ligada, quem tiver o código manda pedidos aos seus agentes.
- Nenhum token ou credencial passa pelo app: a autenticação é toda dos CLIs. A exceção é o compartilhamento de MCP, se você ligar: as definições dos servidores da conta padrão do Claude (que podem conter chave) são copiadas para `~/.revoada/mcp-claude.json`, legível só pelo seu usuário.
- Os agentes não herdam as variáveis internas da Revoada (`REVOADA_*`, `PORT`): um agente que suba outra Revoada ou rode os testes dela não enxerga a pasta de dados nem a porta desta.
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

`tests/flows.test.ts` sobe o servidor de verdade numa pasta de usuário descartável, com CLIs de mentira no `PATH` (`tests/stubs/`) que falam os mesmos protocolos dos reais. Cobre contas, conversa, rodízio, permissão, consumo, anexos, cérebro, cópias, importação, revisão cruzada e o acesso pelo celular (código, bloqueio e o que a porta não expõe). `tests/agenda.test.ts` cobre o relógio dos agendamentos sem esperar o relógio de verdade. `tests/safe.test.ts` cobre o que roda sem perguntar e `tests/md.test.ts` a formatação das respostas, incluindo texto que tenta virar marcação. Não toca na sua pasta de usuário nem gasta conta.

`tests/bracos.test.ts` cobre o quadro, o plano em arquivo, a busca no conteúdo e o modelo automático. `tests/modelo.test.ts` cobre modelo, esforço, janela de contexto e a volta da conversa a um ponto; `tests/pagina.test.ts` confere que o script de cada página compila (nome declarado duas vezes derruba o painel inteiro). `tests/tela.test.ts` abre o painel num Chrome sem janela e mede o que só existe na tela: nada passa da largura da conversa, o texto chega aos poucos sem consulta repetida, o comando não aparece duas vezes e a fila funciona pelo teclado. No macOS as medidas de largura são repetidas num WKWebView (`tests/webkit.swift`), que é o motor da janela do app. Sem Chrome instalado esse arquivo é pulado.

O que os testes não cobrem: a janela nativa (barra de menus, vigília) e os CLIs reais. Se um provedor mudar o formato de saída, os testes continuam passando.

## Mexer na interface

```bash
bun run demo
```

Sobe o painel em `http://127.0.0.1:4790` com conversas de exemplo (uma resposta longa e formatada, uma parada pedindo permissão, uma revisada por outra conta), numa pasta de usuário descartável e com os agentes de mentira dos testes. Não gasta conta nem toca nos seus dados. Edite `public/` e recarregue a página; `Ctrl+C` encerra e apaga tudo.

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
- Pedido agendado não acorda o Mac nem roda com a Revoada fechada.
- O raio-x divide a entrada por estimativa (uns 4 caracteres por token); só os totais vêm do agente.
- A sugestão do próximo pedido e os títulos usam uma conta do Claude; sem Claude pronto, não aparecem.
- O celular não recebe aviso com a página fechada: notificação de navegador exige HTTPS, e a porta é HTTP.
- Reinstalar o app encerra as sessões de terminal abertas.

## Créditos

- Terminal embutido: [xterm.js](https://xtermjs.org) (MIT).
- A vigília foi inspirada no [Insomnia](https://github.com/krishhgg/Insomnia) (MIT), sem usar código dele.
- O supervisor veio de ideias do [orca](https://github.com/stablyai/orca), [agent-orchestrator](https://github.com/OrchestratorInc/agent-orchestrator), [firstmate](https://github.com/kunchenguid/firstmate) e [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode); os pedidos agendados, do [OpenDots](https://github.com/CopilotKit/OpenDots) e do [OpenBot](https://github.com/CopilotKit/OpenBot); a auditoria de segurança, do [security-audit-skill](https://github.com/cloudflare/security-audit-skill); a arrumação do cérebro, do [ai-memory](https://github.com/akitaonrails/ai-memory) e do [agent-memory](https://github.com/tigerless-labs/agent-memory); as skills em todas as contas, do [skills](https://github.com/vercel-labs/skills). Sem usar código de nenhum deles.
- A revisão cruzada, o acompanhamento pelo celular e os tokens por resposta vieram de ideias do [open-code-review](https://github.com/alibaba/open-code-review), do [coucou](https://github.com/Louis-CFM/coucou) e do [cost-xray](https://github.com/tigerless-labs/cost-xray), sem usar código deles.
- O quadro, o plano em arquivo, a busca nas sessões, o modelo automático e o aviso sonoro vieram de ideias do [vibe-kanban](https://github.com/BloopAI/vibe-kanban), do [planning-with-files](https://github.com/OthmanAdi/planning-with-files), do [agentsview](https://github.com/kenn-io/agentsview), do [claude-code-router](https://github.com/musistudio/claude-code-router) e do [peon-ping](https://github.com/PeonPing/peon-ping), sem usar código deles.
- QR do pareamento: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
- Tipografia: Geist (SIL Open Font License), carregada do Google Fonts.

Revoada não é afiliada à Anthropic, OpenAI, Google ou xAI. Os nomes dos produtos pertencem aos respectivos donos.

## Licença

[MIT](LICENSE).
