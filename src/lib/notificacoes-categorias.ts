// Categorias de notificação Telegram — espelho de supabase/functions/_shared/notificacoes/categorias.ts.
// Manter os dois em sincronia (o front e o Deno não compartilham módulo).
export const CATEGORIAS_NOTIFICACAO = ['vendas', 'perguntas', 'pos_venda', 'financeiro', 'moderacao', 'mensagens', 'integracao', 'pulse', 'estoque', 'vendas_gerencial', 'resumo_diario'] as const;
export type CategoriaNotificacao = (typeof CATEGORIAS_NOTIFICACAO)[number];

// Gerenciais (ADR-0190): só admin assina e o Telegram exige chat privado (chat_id positivo).
export const CATEGORIAS_SO_ADMIN = ['vendas_gerencial', 'resumo_diario'] as const satisfies readonly CategoriaNotificacao[];

// Categorias só de exibição (sino), fora da assinatura da tela Usuários: 'imagem_ia' vai só para quem pediu as
// imagens (ADR-0203 item 11) e não entra em CATEGORIAS_NOTIFICACAO nem em profiles.telegram_categorias.
export type CategoriaExibicao = CategoriaNotificacao | 'imagem_ia';

export const CATEGORIA_LABEL: Record<CategoriaExibicao, string> = {
  imagem_ia: 'Imagens por IA',
  vendas: 'Vendas',
  perguntas: 'Perguntas',
  pos_venda: 'Pós-venda',
  financeiro: 'Financeiro',
  moderacao: 'Moderação',
  mensagens: 'Mensagens',
  integracao: 'Integração',
  pulse: 'Pulse (mercado)',
  estoque: 'Estoque',
  vendas_gerencial: 'Vendas (gerencial)',
  resumo_diario: 'Resumo diário',
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
  vendas_gerencial: 'Total do carrinho, lucro e margem a cada venda. Só admin.',
  resumo_diario: 'Resultado do dia anterior às 8h. Só admin.',
};
