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
] as const;

export type CategoriaNotificacao = (typeof CATEGORIAS_NOTIFICACAO)[number];
