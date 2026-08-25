// Categorias de notificação Telegram — espelho de supabase/functions/_shared/notificacoes/categorias.ts.
// Manter os dois em sincronia (o front e o Deno não compartilham módulo).
export const CATEGORIAS_NOTIFICACAO = ['vendas', 'perguntas', 'pos_venda', 'financeiro', 'moderacao', 'mensagens', 'integracao', 'pulse', 'estoque'] as const;
export type CategoriaNotificacao = (typeof CATEGORIAS_NOTIFICACAO)[number];

export const CATEGORIA_LABEL: Record<CategoriaNotificacao, string> = {
  vendas: 'Vendas',
  perguntas: 'Perguntas',
  pos_venda: 'Pós-venda',
  financeiro: 'Financeiro',
  moderacao: 'Moderação',
  mensagens: 'Mensagens',
  integracao: 'Integração',
  pulse: 'Pulse (mercado)',
  estoque: 'Estoque',
};

export const CATEGORIA_DESCRICAO: Record<CategoriaNotificacao, string> = {
  vendas: 'Nova venda paga',
  perguntas: 'Pergunta de comprador',
  pos_venda: 'Devolução ou reclamação',
  financeiro: 'Liberação de saldo no Mercado Pago',
  moderacao: 'Anúncio moderado e catálogo sem match',
  mensagens: 'Mensagem pós-venda de comprador',
  integracao: 'Conexão com o Mercado Livre parou de sincronizar',
  pulse: 'Alertas de concorrência: queda de preço, novo concorrente, saída de concorrente.',
  estoque: 'Estoque zerado (anúncio pausado no ML) e volta ao ar após a reposição.',
};
