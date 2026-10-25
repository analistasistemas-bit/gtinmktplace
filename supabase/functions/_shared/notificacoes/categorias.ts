// Categorias de notificação Telegram — eixo da assinatura por destinatário.
// Um destinatário (profile) recebe as categorias listadas em profiles.telegram_categorias.
// DUPLICADO no front em src/lib/notificacoes-categorias.ts (Deno não compartilha módulo com o
// front); manter os dois em sincronia — igual ao MOTIVO_LABEL de telegram.ts.
export const CATEGORIAS_NOTIFICACAO = [
  'vendas',
  'perguntas',
  'pos_venda',
  'financeiro',
  'moderacao',
  'mensagens',
  'integracao',
  'pulse',
  'estoque',
  'vendas_gerencial',
  'resumo_diario',
] as const;

export type CategoriaNotificacao = (typeof CATEGORIAS_NOTIFICACAO)[number];

/** Categorias gerenciais (ADR-0190): só profile admin assina e o Telegram só vai a chat privado
 * (chat_id positivo) — lucro e faturamento não podem cair em grupo. In-app vale para todo admin assinante. */
export const CATEGORIAS_SO_ADMIN = ['vendas_gerencial', 'resumo_diario'] as const satisfies readonly CategoriaNotificacao[];

export const ehSoAdmin = (categoria: string): boolean => (CATEGORIAS_SO_ADMIN as readonly string[]).includes(categoria);
