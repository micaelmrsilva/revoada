# Revoada

Um app para macOS que junta as suas contas de agentes de código (Claude Code, Codex, Gemini CLI, Grok) num lugar só: uma conversa, várias contas, e o trabalho continua quando uma delas bate no limite.

*A local macOS app that runs several Claude Code, Codex, Gemini CLI and Grok accounts side by side, rotates between them when one hits its usage limit, and carries the conversation along. Interface in Brazilian Portuguese.*

## O que faz

### Várias contas, uma conversa

- **Contas isoladas por provedor.** Cada conta é um perfil com configuração própria. O login é o do CLI oficial; a Revoada não copia token nem fala com a API por conta própria.
- **Rodízio que leva a conversa.** Quando uma conta bate no limite, o pedido continua na próxima, com o histórico do que foi dito e feito. Vale também para trocar de agente à mão, até entre provedores.
- **Uso à vista.** Quanto cada conta já usou das janelas do provedor e quando renovam, a janela de contexto da conversa, e os tokens de cada resposta. O rodízio começa pela conta mais folgada.
- **Skills e MCP em todas as contas.** O que está instalado na conta padrão passa a valer nas outras.

### A conversa

- **Conversa de verdade.** Texto formatado, passos do agente numa linha cada, arquivos editados e o diff do que mudou, em vez da tela crua do terminal. O terminal de cada agente continua disponível.
- **Ao vivo e com fila.** A resposta chega enquanto é escrita. O que você escrever enquanto o agente trabalha entra na fila e segue sozinho quando ele termina.
- **Modelo e esforço por conversa.** Escolhidos no campo de pedido. No automático, a Revoada lê o pedido e escolhe o porte: consulta rápida no modelo mais barato, trabalho pesado no mais forte.
- **Permissão por ação.** No modo "Pergunta antes", o agente para e mostra o comando ou o arquivo antes de agir. O que só lê roda direto.
- **Copiar, editar e tentar de novo.** Editar uma mensagem sua volta a conversa àquele ponto; tentar de novo refaz a última resposta.
- **Plano em arquivo.** Em tarefa longa, o agente mantém um plano em markdown, marca os passos e continua dele se a conversa for cortada ou trocar de conta.
- **Sugestão do próximo pedido.** Quando o agente termina, o campo oferece a próxima mensagem provável: Tab aceita, Enter envia.
- **Busca no conteúdo.** A busca da lateral procura no que foi dito dentro das conversas, as daqui e as que o Claude Code e o Codex já guardaram na máquina.

### Vários agentes ao mesmo tempo

- **Quadro de tarefas.** Despeje as tarefas, uma por linha, e cada cartão vira um agente numa cópia própria do repositório. O cartão vai sozinho para "Revisar" quando o agente termina.
- **Supervisor.** Você descreve um trabalho grande, um agente divide em tarefas, você aprova o plano, cada tarefa roda em paralelo e no fim um agente junta os branches.
- **Cópia isolada por tarefa.** Cada tarefa paralela roda num `git worktree` próprio, que some sozinho quando o trabalho vira PR. A Revoada também acha e limpa os clones que os agentes deixam para trás.
- **Revisão cruzada.** Uma conta de outro provedor lê o que o agente mudou, sem poder editar, e aponta defeitos na própria conversa. Um botão manda os achados de volta para o autor corrigir.
- **Auditoria de segurança.** Outro tipo de revisão, com roteiro próprio: por onde entra dado de fora, onde ele chega, o que dá para explorar.

### Sem ficar olhando

- **Pedidos agendados.** "Roda isso às 3h" ou "toda segunda às 9h": na hora marcada vira uma conversa nova.
- **Aviso sonoro.** Um som quando um agente termina um trabalho demorado e outro quando ele precisa de você.
- **Barra de menus.** O que está rodando, os limites e um campo de pedido rápido (`⌃⌥Espaço`).
- **Acompanhar pelo celular.** Uma página leve, em outro aparelho da sua rede, para ver o que está rodando, permitir ou negar um pedido e parar um agente. Desligada por padrão.
- **Mac acordado enquanto os agentes trabalham**, e só enquanto trabalham. Com a tampa fechada também, depois de um passo de administrador.

### Memória

- **Cérebro compartilhado.** Um cofre do [Obsidian](https://obsidian.md) que espelha a memória de cada agente e entrega as notas relevantes como contexto de cada pedido, para qualquer conta. Temas sensíveis (finanças, infraestrutura) ficam de fora.
- **Arrumação do cérebro.** Aponta nota vazia, cópia idêntica, notas parecidas e notas paradas.

### Para agentes

- **Ferramentas da própria Revoada.** Cada agente do Claude e do Codex pode criar tarefa no quadro, delegar a outra conta, pedir revisão, agendar e consultar, com travas no servidor.
- **Linha de comando.** `revoada`, para scripts e agentes de fora.

Detalhes em [Para agentes](#para-agentes-1).

## Requisitos

- macOS 13 ou mais novo, em Apple Silicon.
- [Bun](https://bun.sh) 1.4 ou mais novo.
- Ferramentas de linha de comando do Xcode (`xcode-select --install`), para montar o app.
- Pelo menos um dos CLIs instalado e logado: [Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli) ou Grok CLI.

Opcionais: [GitHub CLI](https://cli.github.com) (estado dos PRs na limpeza de clones), Obsidian (para abrir o cofre), [Ollama](https://ollama.com) (busca por significado no cérebro) e [ripgrep](https://github.com/BurntSushi/ripgrep) (busca rápida nas conversas dos outros programas).

## Instalar

```bash
git clone https://github.com/micaelmrsilva/revoada.git
cd revoada
bun install
bun run app:install
```

O último comando roda os testes, monta `Revoada.app` e copia para `/Applications`. O app é assinado só localmente: funciona na máquina em que foi montado. Reinstalar encerra as sessões de terminal abertas.

Para rodar sem o app, direto no navegador:

```bash
bun start   # http://127.0.0.1:4777
```

## Para agentes

### Dentro da Revoada

Toda conversa com o Claude ou o Codex sobe uma ponte MCP chamada `revoada`, com nove ferramentas:

| Ferramenta | O que faz |
| --- | --- |
| `estado` | Contas prontas, quanto ainda pode criar, o que ele já abriu. |
| `quadro_listar` | As tarefas do quadro deste projeto. |
| `quadro_criar_tarefa` | Põe uma tarefa no quadro para outro agente fazer. |
| `delegar` | Abre uma conversa com outro agente e devolve o id. |
| `conversa_ler` | Estado e resposta de uma conversa que ele abriu; pode esperar ela terminar. |
| `pedir_revisao` | Outra conta revisa o que ele mudou, quando a resposta terminar. |
| `agendar` | Agenda um pedido, uma vez ou todo dia. |
| `buscar_conversas` | Procura no que já foi dito neste projeto. |
| `cerebro_buscar` | Procura na memória compartilhada. |

O guia que o agente recebe está em `agent-guide.ts`. Gemini e Grok ficam de fora: os CLIs deles não aceitam servidor MCP por argumento.

As travas ficam no servidor, não na boa vontade do agente:

- **Limite por conversa.** No máximo 8 tarefas, delegações e agendamentos somados (`REVOADA_AGENT_BUDGET`).
- **Sem cadeia.** Agente aberto por outro agente não delega nem cria tarefa.
- **Modo respeitado.** Conversa em modo só leitura consulta e não cria. Acesso total não passa adiante: quem é aberto por agente roda no máximo como "pode editar".
- **Alcance.** O agente só lê conversas que ele mesmo abriu, e a busca dele só enxerga o projeto em que está.
- **O que não existe.** Não há ferramenta para aprovar permissão, mudar ajuste, mexer em conta, parar ou apagar conversa.

A credencial é por conversa, assinada com um segredo desta máquina, e só vale em `/agent/*`. Para desligar: Ajustes > "Agentes usam a Revoada".

### De fora: a linha de comando

```bash
bun link                      # uma vez, na pasta da Revoada: cria o comando `revoada`
revoada pedir "roda os testes e me diz o que falhou" --agente codex --esperar
revoada tarefa "ajustar o rodapé" --comecar
revoada conversa <id> --esperar --json
revoada ajuda
```

Fala com a Revoada aberta nesta máquina. Toda saída aceita `--json`.

| Código de saída | Significa |
| --- | --- |
| 0 | Deu certo. |
| 1 | Erro de uso. |
| 2 | O agente terminou com erro. |
| 3 | O agente está esperando a sua permissão. |
| 4 | A Revoada não está aberta. |

### Erros

Todo erro, do painel, das ferramentas e da linha de comando, traz um `code` estável além da frase: `pasta_nao_existe`, `sem_conta_pronta`, `agente_ocupado`, `nao_existe`, `pedido_vazio`, `conta_no_limite`, `nao_e_repositorio`, `ja_feito`, `limite_de_tarefas`, `sem_delegacao`, `somente_leitura`, `fora_do_alcance`, `nao_autorizado`, `desligado`, `revoada_fechada`, `invalido`.

## Segurança

A Revoada executa agentes que rodam comandos na sua máquina. Por isso:

- **Só local.** O painel só escuta em `127.0.0.1` e recusa qualquer chamada cuja origem não seja a própria página.
- **Credenciais.** A autenticação com os provedores é toda dos CLIs: nenhum token deles passa pelo app. Duas coisas ficam em disco, legíveis só pelo seu usuário: as definições dos servidores MCP da conta padrão do Claude, se você ligar o compartilhamento (`~/.revoada/mcp-claude.json`, podem conter chave), e a credencial de agente de cada conversa (`~/.revoada/agentes/`). No Codex as duas vão como argumento de linha de comando, então aparecem na lista de processos do seu usuário.
- **Ambiente dos agentes.** Eles não herdam as variáveis internas da Revoada (`REVOADA_*`, `PORT`).
- **"Pergunta antes".** O agente não age sem sua resposta, com uma exceção que você pode desligar em Ajustes: o que só lê (listar, buscar, ver arquivo, consultar o git e o GitHub) roda direto. A regra é uma lista do que se sabe seguro, em `safe.ts`; redirecionamento para arquivo, substituição de comando, segundo plano e qualquer programa fora da lista continuam perguntando. Ler não tem limite de pasta, então um comando de leitura pode mostrar ao agente um arquivo sensível fora do projeto. Hoje só o Claude oferece este modo; os outros caem para "Pode editar", com aviso na conversa.
- **Cérebro.** Notas de tema bloqueado não são copiadas para o cofre nem enviadas como contexto. O bloqueio vale para o que a Revoada envia; um agente com acesso a arquivos ainda pode ler a pasta de memória de outro.
- **Termos dos provedores.** Usar várias contas pode ter regras próprias em cada um. Leia os termos de uso.

### Acompanhar pelo celular

É a única coisa que escuta na rede, e só quando você liga.

- É outra porta (a do painel mais um), com uma API própria e pequena: ver conversas e limites, permitir ou negar, parar e, com uma segunda chave, escrever numa conversa que já existe. Criar conta, abrir terminal, mudar ajuste e ler o cérebro não existem ali.
- O acesso é por um código aleatório que vai no QR. Errar oito vezes bloqueia o aparelho por dez minutos; trocar o código derruba todos os pareados.
- **A conexão não é cifrada.** Use na rede de casa ou pelo Tailscale, nunca em Wi-Fi público.
- Com a chave de escrever ligada, quem tiver o código manda pedidos aos seus agentes.

## Onde ficam os seus dados

Nada sai da máquina além do que cada CLI já envia ao próprio provedor.

| Caminho | Conteúdo |
| --- | --- |
| `~/.revoada/` | Contas, conversas, anexos, consumo, ajustes, quadro, agendamentos e o registro do app. |
| `~/.revoada/profiles/` | A configuração isolada de cada conta extra. |
| `~/.revoada/worktrees/` | Cópias isoladas criadas para tarefas. |
| `~/.revoada/plans/` | Planos em arquivo das tarefas longas. |
| `~/revoada-cerebro/` | O cofre do cérebro. |

Variáveis de ambiente: `REVOADA_HOME` (dados), `REVOADA_VAULT` (cofre), `REVOADA_PROJECTS` (pasta dos seus repositórios, padrão `~/git`), `PORT`, `REVOADA_REMOTE_PORT` (porta do celular, padrão `PORT` + 1) e `REVOADA_AGENT_BUDGET` (criações por conversa, padrão 8).

## Mac acordado com a tampa fechada

Com a tampa aberta, a Revoada já segura o Mac acordado enquanto há agente trabalhando, sem configuração. Com a tampa fechada o macOS exige desligar o sono do sistema, o que precisa de administrador:

```bash
scripts/vigilia-setup.sh
```

O script instala uma regra de `sudo` restrita a `pmset -a disablesleep 0` e `1`, e um vigia que religa o sono se o app morrer ou passar de 6 horas. A regra vale para qualquer programa rodando como o seu usuário. Para desfazer: `scripts/vigilia-setup.sh --remover`.

O Mac volta a dormir quando ninguém trabalha, com bateria abaixo de 15% ou em temperatura crítica. **Use em superfície ventilada, nunca dentro de mochila.**

## Como funciona

A Revoada é um servidor local em Bun com uma página, embrulhado numa janela nativa.

| Arquivo | Papel |
| --- | --- |
| `server.ts` | Servidor HTTP e WebSocket: contas, sessões de terminal, respostas em paralelo, ajustes e as rotas dos agentes. |
| `convos.ts` | Conversas. Roda cada resposta no modo estruturado do CLI e traduz os eventos em itens. Cuida da retomada de sessão, do rodízio, da fila e dos pedidos de permissão. |
| `brain.ts` | Cérebro: espelho da memória dos agentes num cofre, regras de bloqueio e busca. |
| `board.ts` | Quadro de tarefas: cartões, colunas e o que anda sozinho. |
| `missions.ts` | Supervisor: plano, aprovação, tarefas em paralelo, revisão e junção. |
| `schedule.ts` | Pedidos agendados: o relógio e a regra de hora perdida. |
| `route.ts` | Modelo automático: as regras que dão o porte de um pedido. |
| `safe.ts` | Decide se um comando só lê, para rodar sem perguntar. |
| `tools.ts` | Skills e servidores MCP da conta padrão nas outras contas. |
| `clones.ts` | Cópias de repositório: detecção, classificação e limpeza. |
| `history.ts` | Leitura e busca no histórico do Claude Code e do Codex. |
| `remote.ts` | Acompanhamento pelo celular: a segunda porta, o código de acesso e a API reduzida. |
| `mcp.ts` | A ponte MCP que os CLIs sobem para falar com a Revoada (`--mcp`). |
| `agent-guide.ts` | O guia de uso para agentes. |
| `cli.ts` | A linha de comando `revoada`. |
| `public/` | A página principal (`index.html`), o painel da barra de menus (`mini.html`), a página do celular (`remoto.html`), o markdown das respostas (`md.js`) e a conversa ao vivo (`sync.js`). |
| `desktop/` | A janela nativa em Swift: sobe o servidor, barra de menus, avisos e vigília. |

### Contas e conversa

- **Contas isoladas.** Cada conta extra é um diretório em `~/.revoada/profiles/<id>`, passado ao CLI pela variável que ele já entende (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`). A conta "padrão desta máquina" é a que o CLI usa fora do app.
- **Rodízio.** Enquanto a conta é a mesma, cada resposta retoma a sessão nativa do agente. Quando a conta muda, a próxima recebe um resumo do que foi dito e feito na frente do pedido. O limite é detectado pela mensagem de erro do próprio CLI.
- **Conversa ao vivo.** Com a conversa aberta, a página mantém uma conexão (`/api/convos/<id>/stream`, Server-Sent Events). O primeiro aviso leva a conversa inteira; os seguintes, só os itens que mudaram. A página do celular ainda consulta de tempo em tempo.
- **Editar e tentar de novo.** A conversa é cortada na mensagem escolhida e ela é mandada outra vez. Nenhum CLI desfaz um trecho da própria sessão, então o agente começa uma sessão nova com o histórico do que ficou. Arquivos que a resposta descartada já tinha mexido continuam como estão.
- **Modelo automático.** A escolha é por regras em `route.ts`, sem chamar modelo nenhum para decidir: palavras de trabalho pesado (refatorar, investigar, auditar, "por que") ou pedido longo vão no modelo mais forte; pergunta curta ou gesto único (rodar os testes, fazer o commit) no mais barato; o resto no do meio. Só o seu texto conta, não o que a Revoada põe em volta.
- **Plano em arquivo.** O arquivo fica fora do repositório. As instruções vão uma vez por sessão do agente; sessão nova (troca de conta, tentar de novo) recebe o plano como está.

### Trabalho em paralelo

- **Quadro.** Cada cartão começado é uma conversa comum numa cópia isolada. Quando o agente termina, o cartão vai para "Revisar"; se ele mexeu em arquivo, outra conta revisa antes. Só você move para "Feito".
- **Supervisor.** O planejador roda em modo só leitura e devolve as tarefas num bloco JSON; nada é executado antes de você aprovar. São no máximo cinco tarefas por pedido. "Juntar os branches" abre mais uma conversa, numa cópia nova, que faz o merge de cada branch e roda os testes.
- **Revisão cruzada.** O revisor recebe o seu pedido e o diff (numa cópia isolada, tudo desde que ela se separou da principal; arquivo novo fora do git entra inteiro) e roda em modo só leitura, numa sessão própria. A escolha é outro provedor primeiro, porque outro modelo erra em lugares diferentes; sem outro pronto, outra conta do mesmo.
- **Pedidos agendados.** O relógio só anda com a Revoada aberta e o Mac acordado. Hora perdida por até 6 horas roda quando o Mac volta; perdida por mais que isso é pulada e fica anotada. Pedido agendado no modo "Pergunta antes" roda como "Pode editar", porque não há ninguém para responder.

### Memória e ferramentas

- **Cérebro.** `Agentes/` e `Projetos/` no cofre são espelho (a origem manda, a sincronização sobrescreve). `Revoada/` são notas próprias, onde você ou qualquer agente pode escrever. A busca é local, por palavra (BM25); com um modelo de embeddings no Ollama passa a considerar também o significado.
- **Skills e MCP.** A conta padrão de cada provedor é a fonte. Skill entra nas outras contas como atalho (symlink) para a pasta original; a Revoada só mexe nos atalhos que ela criou. Servidor MCP vai como argumento em cada execução (`--mcp-config` no Claude, `-c mcp_servers…` no Codex). Gemini e Grok recebem as skills, não os servidores MCP.

## Desenvolver

### Mexer na interface

```bash
bun run demo
```

Sobe o painel em `http://127.0.0.1:4790` com conversas de exemplo (uma resposta longa e formatada, uma parada pedindo permissão, uma revisada por outra conta), numa pasta de usuário descartável e com os agentes de mentira dos testes. Não gasta conta nem toca nos seus dados. Edite `public/` e recarregue a página; `Ctrl+C` encerra e apaga tudo.

### Testes

```bash
bun test
```

Os testes sobem o servidor de verdade numa pasta de usuário descartável, com CLIs de mentira no `PATH` (`tests/stubs/`) que falam os mesmos protocolos dos reais. Não tocam na sua pasta de usuário nem gastam conta.

| Arquivo | Cobre |
| --- | --- |
| `flows.test.ts` | Contas, conversa, rodízio, permissão, consumo, anexos, cérebro, cópias, importação, revisão, supervisor, skills e MCP, e o acesso pelo celular. |
| `modelo.test.ts` | Modelo, esforço, janela de contexto, e editar e tentar de novo. |
| `bracos.test.ts` | Quadro, plano em arquivo, busca no conteúdo e modelo automático. |
| `agentes.test.ts` | A ponte MCP (os agentes de mentira sobem a ponte de verdade), as travas, os códigos de erro e a linha de comando. |
| `agenda.test.ts` | O relógio dos agendamentos, sem esperar o relógio de verdade. |
| `safe.test.ts` | O que roda sem perguntar, incluindo dezenas de jeitos de esconder escrita num comando com cara de leitura. |
| `md.test.ts` | A formatação das respostas, incluindo texto que tenta virar marcação. |
| `pagina.test.ts` | O script de cada página compila (nome declarado duas vezes derruba o painel inteiro). |
| `tela.test.ts` | O painel num Chrome sem janela: nada passa da largura, o texto chega aos poucos, a fila e as ações funcionam pelo teclado, o quadro anda. No macOS as medidas de largura são repetidas num WKWebView, que é o motor da janela do app. Sem Chrome instalado é pulado. |

O que os testes não cobrem: a janela nativa (barra de menus, vigília) e os CLIs reais. Se um provedor mudar o formato de saída, os testes continuam passando.

### Distribuir

```bash
SIGN_ID="Developer ID Application: Nome (TEAMID)" NOTARY_PROFILE=<perfil> bun run app:zip
```

Sem `SIGN_ID`, o zip abre em outro Mac por clique direito > Abrir.

## Limitações conhecidas

- Só macOS em Apple Silicon. O servidor roda em Linux (é onde os testes rodam), mas o app não.
- Interface só em português.
- Aprovação por ação, texto ao vivo e janela de contexto funcionam só com o Claude.
- As ferramentas da Revoada para agentes funcionam só com o Claude e o Codex.
- O Grok não tem modo estruturado conhecido: a resposta chega como texto único.
- Pedido agendado não acorda o Mac nem roda com a Revoada fechada.
- O modelo automático decide por regras simples e erra em pedido ambíguo.
- O raio-x divide a entrada por estimativa (uns 4 caracteres por token); só os totais vêm do agente.
- A sugestão do próximo pedido e os títulos usam uma conta do Claude; sem Claude pronto, não aparecem.
- O celular não recebe aviso com a página fechada: notificação de navegador exige HTTPS, e a porta é HTTP.
- Abaixo de 600 de largura o painel fica espremido; para isso existe a página do celular.

## Créditos

Dependências: [xterm.js](https://xtermjs.org) (terminal embutido, MIT), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (QR do pareamento, MIT) e a tipografia Geist (SIL Open Font License), carregada do Google Fonts.

Ideias que vieram de outros projetos, sem usar código de nenhum deles:

| O que | De onde veio a ideia |
| --- | --- |
| Mac acordado | [Insomnia](https://github.com/krishhgg/Insomnia) |
| Supervisor | [orca](https://github.com/stablyai/orca), [agent-orchestrator](https://github.com/OrchestratorInc/agent-orchestrator), [firstmate](https://github.com/kunchenguid/firstmate), [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) |
| Pedidos agendados | [OpenDots](https://github.com/CopilotKit/OpenDots), [OpenBot](https://github.com/CopilotKit/OpenBot) |
| Revisão cruzada | [open-code-review](https://github.com/alibaba/open-code-review) |
| Auditoria de segurança | [security-audit-skill](https://github.com/cloudflare/security-audit-skill) |
| Acompanhar pelo celular | [coucou](https://github.com/Louis-CFM/coucou) |
| Tokens por resposta e raio-x | [cost-xray](https://github.com/tigerless-labs/cost-xray) |
| Arrumação do cérebro | [ai-memory](https://github.com/akitaonrails/ai-memory), [agent-memory](https://github.com/tigerless-labs/agent-memory) |
| Skills em todas as contas | [skills](https://github.com/vercel-labs/skills) |
| Quadro de tarefas | [vibe-kanban](https://github.com/BloopAI/vibe-kanban) |
| Plano em arquivo | [planning-with-files](https://github.com/OthmanAdi/planning-with-files) |
| Busca nas sessões | [agentsview](https://github.com/kenn-io/agentsview) |
| Modelo automático | [claude-code-router](https://github.com/musistudio/claude-code-router) |
| Aviso sonoro | [peon-ping](https://github.com/PeonPing/peon-ping) |

Revoada não é afiliada à Anthropic, OpenAI, Google ou xAI. Os nomes dos produtos pertencem aos respectivos donos.

## Licença

[MIT](LICENSE).
