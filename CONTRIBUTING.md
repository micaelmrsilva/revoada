# Contribuindo

Obrigado pelo interesse. Algumas coisas que ajudam uma mudança a entrar rápido.

## Antes de abrir um PR

```bash
bun install
bun test
```

Os testes sobem o servidor com CLIs de mentira (`tests/stubs/`) e levam poucos segundos. Se a sua mudança mexe num fluxo coberto, o teste correspondente precisa continuar passando. Se cria um fluxo novo no servidor, acrescente um caso em `tests/flows.test.ts`.

Para ver a interface, `bun start` e abra `http://127.0.0.1:4777`. Para o app, `bun run app:install` (encerra as sessões de terminal abertas).

## O que cuidar

- **Segurança primeiro.** O servidor executa agentes na máquina do usuário. Ele só escuta em `127.0.0.1` e confere a origem de cada chamada; não afrouxe isso sem uma boa razão escrita no PR.
- **Sem credenciais.** A Revoada não lê, copia nem guarda token de provedor. A autenticação é sempre a do CLI oficial.
- **Formato dos CLIs.** Os tradutores de eventos ficam em `convos.ts`. Ao mexer neles, confira contra a saída real do CLI e atualize o CLI de mentira correspondente.
- **Nada muda no sistema sem volta.** O que altera estado fora da pasta de dados (sono do sistema, apps pausados, cópias removidas) é anotado antes e tem como ser desfeito.
- **Texto da interface** em português do Brasil, direto, sem jargão.

## Relatando defeitos

Diga o que fez, o que esperava e o que aconteceu, com a versão do macOS e do CLI envolvido. O registro do app fica em `~/.revoada/app.log`; confira se não há nada pessoal antes de colar.

Falha de segurança: não publique os detalhes numa issue. Abra uma issue pedindo um canal privado, sem descrever a falha, e combine por lá.
