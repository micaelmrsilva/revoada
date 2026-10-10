// Modelo automático: escolhe o porte do modelo pelo pedido, sem gastar chamada de modelo pra decidir.
// São regras simples e à vista. Errar para cima custa cota; errar para baixo custa uma resposta fraca,
// que você refaz com "Tentar de novo" escolhendo o modelo. Na dúvida fica no meio.
export type Tier = "leve" | "medio" | "pesado";

// trabalho que pede raciocínio longo ou visão do projeto inteiro
const HEAVY = /\b(refator\w*|arquitet\w*|migr\w+|investig\w+|diagnostic\w+|depur\w+|debug\w*|projet[ae]\w*|planej\w+|redesenh\w+|reescrev\w+|audit\w+|seguran[çc]a|vulnerab\w+|concorr[êe]ncia|race condition|deadlock|performance|otimiz\w+|por que|causa raiz|root cause|trade-?offs?|estrat[ée]gia|compar[ae]\w*|revis[ae] (?:tudo|o projeto|a arquitetura)|do zero|end.to.end|ponta a ponta)\b/i;
// pedido de consulta ou de um gesto só
const LIGHT = /^(?:\s*(?:qual|quais|quanto|quantos|onde|quando|o que [ée]|como (?:se )?(?:chama|roda|rodo)|lista\w*|mostr\w+|me (?:diz|fala|mostra)|resum\w+|explica\w*|traduz\w*|renomei\w+|corrig\w+ (?:o )?(?:typo|erro de digita[çc][ãa]o)|format\w+|roda\w* (?:os )?testes?|faz\w* (?:o )?(?:commit|push)|d[áa] push|status|ok|sim|n[ãa]o|pode|continua\w*|segue|valeu|obrigad\w+)\b)/i;

export function classify(prompt: string, o: { attachments?: number } = {}): Tier {
  const text = prompt.trim(), words = text.split(/\s+/).filter(Boolean).length;
  if (HEAVY.test(text) || words > 180 || text.length > 1400) return "pesado";
  // print ou arquivo anexado quase nunca é pergunta de uma linha
  if (!o.attachments && words <= 28 && !/```/.test(text) && LIGHT.test(text)) return "leve";
  if (!o.attachments && words <= 6) return "leve";
  return "medio";
}

// o que cada porte vira em cada provedor; sem entrada, vale o padrão da conta
const TABLE: Record<string, Record<Tier, { model?: string; effort?: string }>> = {
  claude: { leve: { model: "haiku" }, medio: { model: "sonnet", effort: "medium" }, pesado: { model: "opus", effort: "high" } },
  codex: { leve: { effort: "low" }, medio: { effort: "medium" }, pesado: { effort: "high" } },
};
export const AUTO = "auto";
export const routable = (provider: string) => !!TABLE[provider];
export function route(provider: string, prompt: string, o: { attachments?: number } = {}) {
  const tier = classify(prompt, o);
  return { tier, ...(TABLE[provider]?.[tier] || {}) };
}
