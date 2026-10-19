# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

O produto: servidor local em Bun com uma página (`public/`), embrulhado numa janela nativa em Swift (`desktop/`). A página do projeto: HTML, CSS e JS estáticos em `site/`, sem etapa de build (delegated: o repositório não tem framework web e a página precisa subir em qualquer host; destino de deploy ainda não decidido).

## Users

Dev em Mac com Apple Silicon que usa CLIs de agente de código todo dia (Claude Code e Codex sobretudo; Gemini CLI e Grok menos), tem mais de uma conta (por exemplo Claude Max pessoal e Team do trabalho) e bate no limite de uso no meio da tarefa. Lê em português do Brasil, porque a interface do app é só em português. Chega por um link (GitHub, X, LinkedIn, o portfólio micaelm.com), com pouco tempo e muita página de ferramenta de IA vista antes.

Confirmado pelo usuário em 2026-10-18: o sucesso da página é esse dev instalar o app ou dar estrela no repositório.

## Product Purpose

A Revoada junta várias contas de agentes de código num app local de macOS: uma conversa, várias contas, e quando a conta da frente bate no limite o pedido continua na próxima conta do mesmo provedor, com o histórico do que foi dito e feito. Em volta disso: conversa estruturada com permissão por ação, quadro de tarefas com agentes em paralelo em cópias isoladas (git worktree), revisão cruzada por outro provedor, pedidos agendados, Mac acordado enquanto há agente trabalhando, cérebro compartilhado (cofre do Obsidian), ponte MCP e linha de comando para agentes.

Sucesso da página do projeto: o visitante sai com o app instalado (quatro comandos) ou com o repositório salvo.

## Positioning

Cada conta é um perfil isolado com o login do próprio CLI oficial (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`): a Revoada não copia token, não faz proxy de assinatura e não fala com a API por conta própria. O rodízio leva a conversa junto de uma conta para outra. Tudo roda em `127.0.0.1`; nada sai da máquina além do que cada CLI já envia ao próprio provedor. A revisão cruzada usa outro provedor de propósito, porque outro modelo erra em lugares diferentes.

## Operating Context

Quem visita vive no terminal e no GitHub. O momento de dor é concreto: o CLI avisa que a janela de cinco horas acabou e o trabalho para. Instalar exige Bun 1.4 ou mais novo, as ferramentas de linha de comando do Xcode e pelo menos um CLI logado; o caminho é `git clone`, `bun install`, `bun run app:install` (roda os testes, monta o `Revoada.app` e copia para Aplicativos). Sem o app: `bun start` em `http://127.0.0.1:4777`. Existe um modo de demonstração (`bun run demo`, porta 4790) com agentes de mentira, que mostra a interface real sem gastar conta.

## Capabilities and Constraints

Funções confirmadas no README: contas isoladas por provedor; rodízio que leva a conversa; troca manual de agente, até entre provedores; uso das janelas de cinco horas e de sete dias à vista, com o rodízio começando pela conta mais folgada; skills e MCP da conta padrão nas outras; conversa formatada com passos, diff e terminal; resposta ao vivo e fila; modelo e esforço por conversa, com modo automático; modo "Pergunta antes" (o que só lê roda direto); copiar, editar e tentar de novo; plano em arquivo; sugestão do próximo pedido (Tab aceita, Enter envia); busca no conteúdo das conversas; quadro de tarefas; supervisor; cópia isolada por tarefa; revisão cruzada; auditoria de segurança; pedidos agendados; aviso sonoro; barra de menus com pedido rápido em ⌃⌥Espaço; acompanhar pelo celular (desligado por padrão); Mac acordado enquanto os agentes trabalham; cérebro compartilhado com arrumação; ponte MCP com nove ferramentas e travas no servidor; linha de comando `revoada` com códigos de saída e códigos de erro estáveis.

Limites que a página não pode esconder: só macOS em Apple Silicon; interface só em português; aprovação por ação, texto ao vivo e janela de contexto só com o Claude; ferramentas para agentes só com o Claude e o Codex; Grok sem modo estruturado; pedido agendado não acorda o Mac; app assinado só localmente (sem Developer ID); usar várias contas pode ter regras próprias em cada provedor.

Termos do produto: conta, rodízio, no limite, Pergunta antes, Pode editar, quadro, cópia isolada, revisão cruzada, supervisor, cérebro, Mac acordado, ponte MCP.

## Brand Commitments

- Nome Revoada; no app a marca aparece em minúsculas, "revoada". Logo: três aves em formação, a da ponta em teal (`public/icon.svg`, `public/logo.svg`).
- Interface do app: Geist e Geist Mono nos rótulos, tema claro e escuro, teal como destaque (#0e7490 no claro, #4fc3d9 no escuro), âmbar para limite e espera.
- Voz: português do Brasil, direta, sem jargão, sem travessão, sem emoji, nada festivo. Copy curta.
- Sem bastidor técnico na interface (nada de contador, fps ou colofão técnico); cada dado e o nome aparecem uma vez por tela; espaço vazio precisa de função.
- A página precisa dizer que a Revoada não é afiliada à Anthropic, OpenAI, Google ou xAI.
- A primeira versão da página (bando em V revezando a ponta e céu do dia à madrugada) foi recusada inteira em 2026-10-18: abertura sem impacto, longa demais, visual genérico. Não reaproveitar.

## Evidence on Hand

- Reais: o README, a licença MIT, testes que rodam no GitHub a cada push, versão 1.2.0, o modo de demonstração com a interface real, os dois sons de aviso do app (sintetizados em código em `public/index.html`, tabela `SOUND`), o ícone e o logo.
- O repositório tem 2 estrelas: pouco demais para servir de prova social.
- Não existem: depoimentos, números de usuários ou downloads, benchmarks, imprensa, clientes. Não inventar.

## Product Principles

1. Local e oficial: o login é sempre o do CLI e nada passa pela Revoada além do que o CLI já envia.
2. O trabalho não para: limite, sono e horário não interrompem o que o agente está fazendo.
3. Tudo à vista: quem usa vê cada passo e decide o que roda.
4. Honesta sobre os limites: plataforma, provedores e termos de uso ficam ditos.
