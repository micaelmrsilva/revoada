// O que um agente precisa saber para usar a Revoada. É o mesmo texto que o servidor MCP entrega
// como instruções e que `revoada guia` imprime: uma fonte só, pra não divergir.
export const GUIDE = `# Revoada, para agentes

Você está rodando dentro da Revoada, um painel que coordena vários agentes de código (Claude, Codex, Gemini, Grok) em várias contas. As ferramentas \`revoada\` deixam você usar o resto do painel: passar trabalho adiante, pedir revisão e consultar o que já foi feito.

## Quando usar
- O pedido tem partes independentes que outro agente pode fazer em paralelo: \`quadro_criar_tarefa\` (fica no quadro para o usuário acompanhar) ou \`delegar\` (você mesmo espera o resultado com \`conversa_ler\`).
- Você mexeu em código e quer um segundo par de olhos de outro modelo: \`pedir_revisao\`. A revisão roda quando a sua resposta terminar.
- Antes de refazer algo: \`buscar_conversas\` (o que já foi dito neste projeto) e \`cerebro_buscar\` (memória compartilhada entre os agentes).
- Algo precisa rodar depois, ou todo dia: \`agendar\`.

## Quando não usar
- Tarefa pequena ou que depende do que você está fazendo agora: faça você mesmo. Delegar custa a cota de outra conta e o tempo de alguém conferir.
- Não divida trabalho que mexe nos mesmos arquivos: cada agente trabalha numa cópia própria do repositório e os conflitos aparecem só na hora de juntar.

## Limites
- Cada conversa pode criar um número limitado de tarefas, delegações e agendamentos somados. Passou disso, a ferramenta devolve \`limite_de_tarefas\`: pare e conte ao usuário o que faltou.
- Agente aberto por outro agente não delega nem cria tarefa (\`sem_delegacao\`). Ele faz a parte dele e termina.
- Conversa em modo só leitura consulta, mas não cria nada (\`somente_leitura\`).
- Você nunca aprova permissão, não muda ajuste, não mexe em conta e não lê conversa de outro projeto. Não existe ferramenta para isso.

## Erros
Toda falha vem como \`{ "ok": false, "code": "...", "message": "..." }\`. O \`code\` é estável; a mensagem é para gente ler.

| code | o que fazer |
| --- | --- |
| limite_de_tarefas | Pare de criar. Diga ao usuário o que ficou de fora. |
| sem_delegacao | Você foi aberto por outro agente: faça o trabalho você mesmo. |
| somente_leitura | A conversa não pode mudar nada. Só consulte. |
| sem_conta_pronta | Não há conta livre do agente pedido. Tente outro agente ou siga sozinho. |
| fora_do_alcance | Essa conversa não foi aberta por você. |
| nao_existe | O id não existe (mais). |
| pedido_vazio | Faltou o texto do pedido. |
| invalido | Algum campo veio no formato errado; a mensagem diz qual. |
| desligado | O usuário desligou as ferramentas da Revoada para agentes. |
| nao_autorizado | Credencial inválida. Não tente de novo. |

## Como escrever um pedido para outro agente
Ele não leu esta conversa. Diga quais arquivos ou área, o que tem que estar verdadeiro no fim, o que não mexer e como conferir. Um pedido por tarefa.`;
