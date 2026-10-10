// Aplica um aviso da conversa ao vivo (ver `watch` em convos.ts) no que a página já tem.
// O primeiro aviso de cada conexão traz tudo; os outros, só o que mudou.
(function (root) {
  root.applyStream = function (chat, ev) {
    const c = ev.first || !chat ? { messages: [] } : chat;
    const messages = c.messages;
    for (const k of Object.keys(c)) delete c[k];
    Object.assign(c, ev.meta, { messages });
    for (const m of ev.msgs) {
      const items = m.len < 0 ? null : messages[m.i]?.items || [];
      if (items) { for (const [j, it] of m.at) items[j] = it; items.length = m.len; }
      messages[m.i] = items ? { ...m.head, items } : { ...m.head };
    }
    messages.length = ev.n;
    return c;
  };
})(typeof window !== "undefined" ? window : globalThis);
