---
name: Revoada
description: Página do projeto Revoada no sistema Plumagem da AraraHQ, com foto de bando, letra monumental e conversa transcrita em fita.
colors:
  noite: "#050a0b"
  ink: "#0a0f10"
  ink-2: "#465659"
  ink-3: "#5f7175"
  paper: "#fbfcfc"
  paper-2: "#f1f5f5"
  line: "rgba(10, 15, 16, 0.1)"
  line-2: "rgba(10, 15, 16, 0.2)"
  teal: "#1c99a7"
  teal-ink: "#136f7a"
  mint: "#9be8ea"
  ambar-ink: "#8a5a06"
  plate: "#0f343d"
  plate-hover: "#17505b"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "ajustado em JS à largura da capa (até 28vh em tela deitada, 20vh em pé)"
    fontWeight: 600
    lineHeight: 0.86
    letterSpacing: "-0.055em"
  headline-prancha:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 7.4vw, 7.25rem)"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "-0.052em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.3rem, 7vw, 6.5rem)"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "-0.05em"
  headline-secao:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 5.6vw, 5.25rem)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.3rem, 2.1vw, 1.75rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  fala:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.0625rem, 1.5vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.38
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
  mono:
    fontFamily: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.85
rounded:
  sm: "6px"
  md: "10px"
  lg: "18px"
  pill: "999px"
spacing:
  margem: "clamp(20px, 4.4vw, 64px)"
  container: "1360px"
  secao: "clamp(84px, 11vw, 168px)"
  capitulo: "clamp(72px, 10vw, 150px)"
  bloco: "clamp(28px, 4.5vw, 64px)"
  fala: "14px"
components:
  button-plate:
    backgroundColor: "{colors.plate}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0 26px"
    height: "52px"
  button-plate-hover:
    backgroundColor: "{colors.plate-hover}"
  button-photo:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 26px"
    height: "52px"
  button-photo-hover:
    backgroundColor: "#e4f6f6"
  nav-pill:
    backgroundColor: "{colors.plate}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "40px"
  chip-som:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "0 15px 0 13px"
    height: "40px"
  chip-som-tocando:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
  copiar:
    backgroundColor: "rgba(255, 255, 255, 0.12)"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  copiar-feito:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.plate}"
  comandos-bloco:
    backgroundColor: "rgba(5, 10, 11, 0.62)"
    textColor: "#e6f2f2"
    typography: "{typography.mono}"
    rounded: "{rounded.lg}"
    padding: "20px 112px 20px 22px"
---

# Design System: Revoada

## Overview

**Creative North Star: "O Bando sobre o Papel"**

A Revoada é irmã do ararahq.com e fala a língua da Plumagem: noite quase preta nas pranchas de foto, papel quase branco entre elas, letra Geist enorme e apertada, fio de um pixel e um teal escuro que só aparece onde algo age. A diferença da Arara está na imagem: no lugar da plumagem, fotografias de bando (estorninhos em revoada na capa e no fecho, gansos em V na prova de segurança). O sistema foi fixado pelo usuário em 18/10/2026 e portado do protótipo da Arara (`lp-ticket-alto`), depois adaptado.

A página alterna três pranchas escuras de foto (capa, confiança, fecho) com uma folha de papel que sobe por cima da capa presa. No papel, o produto se mostra como conversa transcrita em fita: hora, quem fala, a frase. Não existe tela desenhada nem moldura de app. A densidade é baixa e editorial: perguntas grandes, um parágrafo curto, uma fita, muito ar medido. A rejeição confirmada é a landing genérica de ferramenta de IA: print do app em moldura, grade de cartões e gradiente decorativo.

O movimento é a assinatura: a capa chega com um zoom lento e respira, o título sobe linha a linha, a frase de baixo gira entre situações e volta à primeira, e cada capítulo toca a conversa fala a fala quando entra na tela. Tudo para com `prefers-reduced-motion`.

**Key Characteristics:**
- Duas superfícies apenas: noite com foto e papel. Nenhuma terceira cor de fundo.
- Letra Geist 600 com tracking negativo forte; o tamanho faz a hierarquia, não a cor.
- Fio fino (1px) estrutura capítulos, fitas, perguntas e fatos; nenhum cartão.
- Teal tinta para agente e resultado; âmbar tinta para limite e perda.
- Pílula branca sobre a foto, placa teal sobre o papel.
- Grão gerado na hora sobre toda foto.

## Colors

Uma paleta quase monocromática de cinzas esverdeados, com o teal como única voz e o âmbar como alarme.

### Primary
- **Placa Petróleo** (plate): fundo do botão principal e da pílula da barra quando ela vira papel. É a cor de ação sobre o papel. No hover escurece para **Petróleo Aceso** (plate-hover).
- **Teal Tinta** (teal-ink): nome de agente na fita, número de resultado na última fala, link com seta no papel, contorno de foco e cursor de texto. Marca quem trabalha e o que deu certo.
- **Teal Vivo** (teal): a ave da ponta do logo sobre o papel e o fundo da seleção de texto. Não serve para texto corrido.

### Secondary
- **Menta** (mint): o equivalente do teal sobre a noite. Ave da ponta do logo sobre a foto e no rodapé, link com seta nas pranchas, foco sobre fundo escuro e o estado "Copiado".

### Tertiary
- **Âmbar Tinta** (ambar-ink): só para o estado de limite na fita ("Limite de uso atingido", "bateu no limite") e para a perda no exemplo de antes ("16 minutos"). Herdado do âmbar de limite e espera do app.

### Neutral
- **Noite** (noite): fundo das pranchas, da capa, do rodapé e do `body`; também o `theme-color`.
- **Tinta** (ink): texto principal no papel, fio forte que abre capítulo e primeira pergunta.
- **Tinta Média** (ink-2): parágrafos de apoio, descrições e fala de antes.
- **Tinta Clara** (ink-3): hora e falante na fita, legenda, fato narrado, a palavra "Quando" das perguntas grandes. Fica acima de 4.5:1 sobre o papel.
- **Papel** (paper): a folha que cobre a capa e a barra rolada.
- **Papel Sombra** (paper-2): fundo do `code` dentro do texto.
- **Fio** (line) e **Fio Forte** (line-2): divisórias entre falas e linhas de lista (line), topo de fita, borda de chip e pé de comparação (line-2).

Sobre a noite, o texto usa branco com opacidade em degraus fixos: 0.86 a 0.84 para lead, 0.7 a 0.62 para apoio e nota, 0.5 para o legal, 0.24 a 0.12 para fios.

### Named Rules
**A Regra das Duas Tintas.** Teal tinta só nomeia agente ou resultado; âmbar tinta só nomeia limite ou perda. Nenhuma das duas decora.

**A Regra do Par Claro e Escuro.** Toda cor de acento tem par: teal tinta e placa no papel, menta e branco na noite. Nunca leve o teal tinta para a foto nem a menta para o papel.

## Typography

**Display Font:** Geist (com ui-sans-serif e system-ui)
**Body Font:** Geist
**Label/Mono Font:** Geist Mono, só para comandos

**Character:** Uma família só, que fica monumental pelo peso 600 e pelo tracking muito negativo e fica calma no corpo em 400. O contraste vem de escala, não de troca de fonte.

### Hierarchy
- **Display** (600, ajustado à largura da capa, 0.86, -0.055em): só o título da capa, "Continue a conversa", em uma linha na tela deitada e duas na tela em pé.
- **Headline de prancha** (600, clamp(2.6rem, 7.4vw, 7.25rem), 0.92, -0.052em): título das pranchas de confiança e fecho, até 12 a 13ch; o fecho sobe até 8rem.
- **Headline** (600, clamp(2.3rem, 7vw, 6.5rem), 0.95, -0.05em): a pergunta grande de cada capítulo ("Quando a tarefa é grande."), com a primeira palavra em tinta clara.
- **Headline de seção** (600, clamp(2.2rem, 5.6vw, 5.25rem), 0.98, -0.045em): título de seção comum, como o das perguntas.
- **Title** (600, clamp(1.3rem, 2.1vw, 1.75rem), 1.15, -0.03em): a virada de cada capítulo e a última fala da fita, quebrada em duas frases.
- **Fala** (400, clamp(1.0625rem, 1.5vw, 1.25rem), 1.38, -0.012em): a frase dentro da fita, até 54ch.
- **Body** (400, 1.0625rem, 1.55): parágrafo de apoio, até 44 a 46ch; cai para 1rem abaixo de 620px.
- **Label** (500, 0.8125rem): hora, falante, legenda, nota. Em caixa normal, sem tracking.
- **Mono** (400, 0.9375rem, 1.85): bloco de comandos de instalação e a linha de comandos da seção de agentes.

### Named Rules
**A Regra do Peso Único.** Título é sempre 600 com tracking negativo proporcional ao tamanho; nunca 700, nunca caixa alta, nunca itálico.

**A Regra do Título que Equilibra.** Títulos usam `text-wrap: balance` e parágrafos `text-wrap: pretty`; frases longas de virada se partem em duas metades explícitas.

## Layout

Coluna única com container de 1360px e margem lateral fluida (`margem`), respeitando a safe area. Capítulos são uma grade assimétrica 5fr / 6fr: texto à esquerda, fita à direita, com vão de até 112px. A comparação antes e depois é uma grade 1fr / 1fr de duas fitas. A confiança usa três colunas de fatos.

O ritmo vertical é grande e regular: seção com `secao` de respiro, capítulos separados por `capitulo` e abertos por um fio de tinta, blocos internos a `bloco`. A fita é uma grade de três colunas (3.6rem hora, 8.4rem falante, resto frase) com 14px de respiro por fala.

A capa ocupa 100svh (mínimo 560px), fica presa no topo e a folha de papel sobe por cima dela com uma sombra ambiente. A barra é fixa, 68px, branca e transparente sobre a capa; vira papel depois dela.

Abaixo de 1100px somem os links da barra. Abaixo de 900px todas as grades viram uma coluna e a linha decorativa de comandos some. Abaixo de 620px a fala passa a hora e o falante numa linha e a frase embaixo, e a base da capa empilha texto, ações e nota.

## Elevation & Depth

O sistema é plano. A profundidade vem da camada, não da sombra: a foto fica atrás de um véu em gradiente escuro e de um grão de ruído, e a folha de papel desliza sobre a capa presa. As fotos das pranchas se deslocam devagar com a rolagem, e a da capa acompanha o ponteiro em sentido oposto ao título.

### Shadow Vocabulary
- **Borda da folha** (`box-shadow: 0 -28px 60px -30px rgba(0, 0, 0, 0.55)`): só na folha que cobre a capa.
- **Vidro do comando** (`box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16), 0 30px 60px -36px rgba(0, 0, 0, 0.8)` com `backdrop-filter: blur(10px)`): só no bloco de comandos sobre a foto do fecho.
- **Fio da barra** (`box-shadow: 0 1px 0 line`): a barra quando vira papel.

### Named Rules
**A Regra do Véu.** Toda foto leva véu e grão. Texto nunca senta direto sobre a imagem crua.

**A Regra do Papel Plano.** No papel não existe sombra; separação é fio de 1px ou espaço.

## Shapes

Duas formas mandam: a pílula (999px) para tudo que se aperta (botão, chip, copiar) e o retângulo sem canto para o resto, cortado por fios. O único bloco com canto é o vidro de comandos (18px). Cantos pequenos de 6px ficam para `code` em linha e para o contorno de foco; 10px só para o link de pular conteúdo. O logo, três aves em formação com a da ponta em acento, é a única silhueta orgânica.

## Components

### Buttons
Firmes e calmos: uma pílula cheia por bloco, acompanhada de um link sublinhado.
- **Shape:** pílula (999px), 52px de altura (50px no celular), seta de 17px em traço à direita.
- **Primary no papel:** placa petróleo com texto branco; hover em petróleo aceso.
- **Primary na foto:** branco com texto em tinta; hover em `#e4f6f6`.
- **Hover / Focus / Active:** a seta anda 3px para a direita; aperto em `scale(0.96)`; foco com contorno de 2px (teal tinta no papel, menta na noite) a 3px de distância.
- **Sub-elo:** texto 500 sublinhado a 1px com 6px de offset, sublinhado em 30% a 40% da cor que fica cheio no hover.
- **Elo com seta:** texto 500 em teal tinta (papel) ou menta (noite), seta que anda no hover, alvo mínimo de 44px.

### Chips
- **Style:** os botões de ouvir os sons do app; pílula de 40px, fundo transparente, borda interna em fio forte, texto tinta média com ícone de alto-falante em traço.
- **State:** hover escurece texto e borda para tinta; tocando inverte para tinta cheia com texto branco.

### Navigation
- Barra fixa de 68px, logo com marca à esquerda, links de seção, GitHub e a pílula "Instalar" à direita.
- Sobre a capa: tudo branco, links ocultos, pílula vazada com borda branca a 30%.
- Depois da capa: fundo papel, fio inferior, links aparecem em 82% de opacidade (100% no hover) e a pílula vira placa petróleo.

### Fita (assinatura)
A conversa transcrita que substitui a tela desenhada. Lista ordenada com fio forte no topo e fio entre falas. Cada fala tem hora em números tabulares, falante em label (teal tinta quando é agente, no formato "Claude · trabalho") e a frase em tamanho de fala. Variações: **fato** (frase narrada, 1rem em tinta clara, sem falante), **limite** (frase em âmbar tinta) e **volta** (última fala em title, sem fio, com o resultado em teal tinta, ou em âmbar tinta quando é perda). Toda fita tem legenda acima dizendo que é exemplo. Ao entrar na tela, cada fala aparece na sua vez com 0.22s de intervalo, subindo 10px e saindo de um desfoque de 4px.

### Par antes e depois
Duas fitas lado a lado com legendas em 500 tinta: à esquerda a situação fora do app (falas em tinta média, perda em âmbar), à direita no app (agentes em teal, resultado em teal). Embaixo, um pé com fio forte, a virada e as ações, que entra 1.2s depois.

### Prancha de confiança
Prancha escura com foto de gansos em V, título de prancha até 13ch, lead em branco 84% e três fatos em coluna, cada um aberto por fio branco a 24%, com o título do fato em 600 e a explicação em `small` branco 70%.

### Bloco de comandos
Vidro escuro de 18px sobre a foto do fecho, comandos em Geist Mono com um `$` em branco 40% que não se seleciona, e o botão Copiar em pílula translúcida no canto, que vira menta com texto petróleo em "Copiado". No celular o botão desce para baixo do bloco e a rolagem horizontal ganha um esmaecido na borda.

### Perguntas
Acordeão de `details` entre fios, o primeiro em tinta. A pergunta em 500, o sinal de mais em traço que gira 45 graus ao abrir, e um fio de tinta que acende embaixo quando o ponteiro chega perto. A resposta abre por `grid-template-rows`.

## Do's and Don'ts

### Do:
- **Do** alternar só duas superfícies: prancha de noite com foto, véu e grão, e folha de papel.
- **Do** mostrar o produto como fala transcrita na fita, sempre com a legenda de exemplo.
- **Do** usar teal tinta só para agente e resultado, e âmbar tinta só para limite e perda.
- **Do** usar uma pílula cheia por bloco de ações, com sub-elo sublinhado ao lado.
- **Do** separar com fio de 1px e espaço; abrir capítulo com fio em tinta.
- **Do** escrever títulos em Geist 600 com tracking negativo e deixar a escala fazer a hierarquia.
- **Do** desligar toda animação e transição com `prefers-reduced-motion`.
- **Do** escrever a interface em português do Brasil, curta, sem travessão e sem emoji, com o nome uma vez por tela.

### Don't:
- **Don't** pôr print do app em moldura, grade de cartões ou gradiente decorativo.
- **Don't** criar terceira cor de fundo, nem cartão com sombra sobre o papel.
- **Don't** pôr texto direto sobre foto sem véu.
- **Don't** usar o teal vivo para texto corrido, nem a menta sobre o papel.
- **Don't** mostrar bastidor técnico na interface (contador, fps, colofão).
- **Don't** reaproveitar a primeira versão recusada (bando em canvas com céu do dia à noite) nem a janela de app recriada.
