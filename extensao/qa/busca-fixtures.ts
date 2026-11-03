// Dados FICTÍCIOS para a prova visual da busca (Task 6). Nenhum token, nenhuma chamada de rede.
// 60 produtos / 68 ocorrências: 8 produtos aparecem 2x (orgânico + patrocinado, preços diferentes).
import type { EstadoBusca } from '../src/busca-sw';
import type { CardBusca, OcorrenciaBusca } from '../src/leitura/busca';
import type { MetadadosCardBusca, ResultadoCard } from '../../supabase/functions/_shared/extensao/busca.ts';
import type { EstadoEnriquecimento, ExataVista, Medalha } from '../src/compartilhado/enriquecimento';

const NOMES = ['Batom Matte', 'Hidratante Facial', 'Sérum Vitamina C', 'Protetor Solar FPS 50', 'Shampoo Antiqueda', 'Condicionador Nutritivo',
  'Máscara Capilar', 'Esmalte Gel', 'Base Líquida', 'Pó Compacto', 'Rímel à Prova d’Água', 'Perfume Floral', 'Sabonete Líquido', 'Creme para Mãos'];
const VENDEDORES = ['BELEZA_LOJA', 'COSMETICOS_BR', 'Casa da Beleza', 'MEGA PERFUMARIA', 'Loja Aurora'];
const VENDIDOS = ['+100 vendidos', '+500 vendidos', '+1mil vendidos', '+5mil vendidos', '+10mil vendidos', null];
const img = (i: number) => `img/p${i % 12}.svg`;

const oc = (posicao: number, preco: number | null, patrocinado: boolean, vendidosTexto: string | null): OcorrenciaBusca => ({ posicao, patrocinado, preco, vendidosTexto });

function card(i: number): CardBusca {
  const preco = 19.9 + ((i * 7.3) % 180);
  const vendidosTexto = VENDIDOS[i % VENDIDOS.length];
  const patro = i % 9 === 4;
  const c: CardBusca = {
    itemId: `MLB${3000000000 + i}`, catalogProductId: i % 3 === 0 ? `MLB${20000000 + i}` : null, userProductId: null, posicao: i + 1,
    titulo: `${NOMES[i % NOMES.length]} ${['Rosa', 'Nude', 'Vinho', 'Natural', 'Intenso'][i % 5]} ${50 + (i % 6) * 10} ml – Kit ${1 + (i % 3)} unidades`,
    preco: Math.round(preco * 100) / 100, vendedor: VENDEDORES[i % VENDEDORES.length], nota: 4 + (i % 10) / 10, vendidosTexto,
    freteGratis: i % 2 === 0 ? true : null, full: i % 4 === 1 ? true : null, lojaOficial: i % 11 === 3 ? true : null, patrocinado: patro,
    selos: [], miniaturaUrl: img(i), identidadeConflitante: false, ocorrencias: [],
  };
  c.ocorrencias = [oc(i + 1, c.preco, patro, vendidosTexto)];
  return c;
}

export const cards: CardBusca[] = Array.from({ length: 60 }, (_, i) => card(i));
export const meta: Record<string, MetadadosCardBusca> = {};
export const resultados: Record<string, ResultadoCard> = {};
const id = (i: number) => cards[i].itemId;
const semVinculo = (i: number) => { meta[id(i)] = { itemId: id(i), proprio: false, vinculo: null }; resultados[id(i)] = { itemId: id(i), estado: 'sem_vinculo' }; };

// 8 duplicatas: mesma oferta, orgânica + patrocinada, preço diferente (60 + 8 = 68 ocorrências).
for (const i of [2, 7, 12, 19, 25, 33, 41, 50]) {
  const c = cards[i];
  c.ocorrencias.push(oc(60 + i, Math.round((c.preco ?? 50) * 1.08 * 100) / 100, true, c.vendidosTexto));
}

// Identificados, sem vínculo (exceto os 5 últimos: ainda sem metadados = "verificando").
for (let i = 0; i < 55; i++) semVinculo(i);

const tipo = (preco: number, pct: number) => ({
  estado: 'ok' as const,
  valor: { comissao: preco * 0.14, imposto: preco * 0.08, frete: 6.9, custo: preco * 0.4, recebe: preco * 0.78, lucro: (preco * pct) / 100, margemPct: pct, avisos: [] },
});
const ok = (i: number, pct: number): ResultadoCard => ({
  itemId: id(i), estado: 'ok', fonte: 'catalogo', codigo: `0000${100 + i}`, custo: {} as never,
  margem: { preco: cards[i].preco!, classico: tipo(cards[i].preco!, pct), premium: tipo(cards[i].preco!, pct - 5) } as never,
});
const vinculado = (i: number, proprio: boolean | null, r: ResultadoCard) => {
  meta[id(i)] = { itemId: id(i), proprio, vinculo: { fonte: 'catalogo', codigo: `0000${100 + i}` } };
  resultados[id(i)] = r;
};

cards[0].miniaturaUrl = 'img/quebrada.png'; // imagem quebrada
cards[1].titulo = 'Kit Completo Cuidados com a Pele e Cabelo Premium Edição Limitada com Sérum Facial Hidratante Antioxidante Vitamina C Protetor Solar Máscara Capilar Reconstrutora Shampoo Condicionador Leave-in Óleo Reparador de Pontas Frasco Grande Família 500 ml Original Lacrado com Nota Fiscal e Garantia de Procedência';
// Meu anúncio, posição 3, orgânico (duplicata com a ocorrência patrocinada na posição 62).
cards[2].posicao = 3; cards[2].patrocinado = false; cards[2].ocorrencias[0] = oc(3, cards[2].preco, false, cards[2].vendidosTexto);
meta[id(2)] = { itemId: id(2), proprio: true, vinculo: null };
vinculado(3, false, ok(3, 23.4)); // SKU vinculado, margem positiva
vinculado(5, false, ok(5, -7.8)); // margem negativa
vinculado(6, false, { itemId: id(6), estado: 'limite', fonte: 'catalogo', codigo: '0000106' }); // aguardando cota
vinculado(8, true, ok(8, 12.1)); // meu anúncio + vinculado
vinculado(9, null, { itemId: id(9), estado: 'sem_categoria', fonte: 'ean_da_busca', codigo: '0000109' }); // proprio desconhecido
vinculado(12, false, ok(12, 18.2)); // duplicata: a margem só vale na ocorrência com o preço calculado
cards[10].identidadeConflitante = true; cards[10].catalogProductId = null; // conflito de identidade
for (let i = 55; i < 60; i++) { delete meta[id(i)]; delete resultados[id(i)]; }

// Enriquecimento (Task 10), FICTÍCIO: medalhas/UFs variadas, catálogo parcial, oferta não localizada, perfil não
// carregado, comissão aguardando/indisponível, catálogo aguardando janela e catálogo ainda sem dado.
export const AGORA_QA = Date.parse('2026-11-03T12:00:00Z');
const diasAtras = (n: number) => new Date(AGORA_QA - n * 86_400_000).toISOString();
export const ENR: EstadoEnriquecimento = { catalogos: {}, vendedores: {}, retomarEm: AGORA_QA + 40_000, falhou: false, indisponivel: null, perfis: 14 };
const comissao = (i: number) => ({ estado: 'ok' as const, valor: { percentual: i % 2 ? 16.5 : 14, fixa: 0, saleFeeAmount: Math.round((cards[i].preco ?? 0) * (i % 2 ? 0.165 : 0.14) * 100) / 100, precoConsultado: cards[i].preco ?? 0 } });
function catalogo(i: number, o: { vendedores: number; completa?: boolean; dias: number | null; exata?: Partial<Extract<ExataVista, { estado: 'ok' }>> | 'nao_encontrada'; seller?: { medalha: Medalha | null; uf: string | null } | 'aguardando' }) {
  const c = cards[i];
  const sellerId = 900 + i;
  const exata: ExataVista = o.exata === 'nao_encontrada' ? { estado: 'nao_encontrada', preco: c.preco! }
    : { estado: 'ok', preco: c.preco!, sellerId, tipo: i % 2 ? 'gold_pro' : 'gold_special', comissao: comissao(i), ...o.exata };
  ENR.catalogos[c.catalogProductId!] = {
    produto: { estado: 'ok', criadoEm: o.dias === null ? null : diasAtras(o.dias) },
    ofertas: { estado: 'ok', total: o.vendedores + 2, lidas: o.vendedores + 2, vendedoresIdentificados: o.vendedores, ofertasSemVendedor: o.completa === false ? 2 : 0, completa: o.completa !== false, exatas: { [c.itemId]: exata } },
  };
  if (o.seller === 'aguardando') ENR.vendedores[sellerId] = { estado: 'aguardando', retomarEm: null, tentativas: 2 };
  else if (o.seller) ENR.vendedores[sellerId] = { estado: 'ok', nome: c.vendedor, ...o.seller };
}
catalogo(0, { vendedores: 9, dias: 120, seller: { medalha: 'platinum', uf: 'SP' } });
catalogo(3, { vendedores: 31, completa: false, dias: 300, exata: { comissao: { estado: 'aguardando' } }, seller: { medalha: 'gold', uf: 'RJ' } });
catalogo(6, { vendedores: 14, dias: 800, exata: 'nao_encontrada' });
catalogo(9, { vendedores: 4, dias: 181, exata: { tipo: null, comissao: { estado: 'indisponivel', motivo: 'tipo do anúncio não confirmado' } }, seller: 'aguardando' });
ENR.catalogos[cards[12].catalogProductId!] = { aguardandoJanela: true };
// cards[21]: catálogo ainda sem dado ("Aguardando dados do catálogo").
catalogo(30, { vendedores: 3, dias: 45, seller: { medalha: 'sem', uf: 'MG' } });
catalogo(15, { vendedores: 7, dias: 400, seller: { medalha: 'platinum', uf: 'SP' } });
catalogo(18, { vendedores: 2, dias: 20, seller: { medalha: 'silver', uf: 'PR' } });
catalogo(24, { vendedores: 45, dias: 900, seller: { medalha: 'gold', uf: 'SC' } });
catalogo(27, { vendedores: 12, dias: 200, seller: { medalha: null, uf: 'BA' } });
catalogo(33, { vendedores: 5, dias: 60, seller: { medalha: 'gold', uf: 'GO' } });
catalogo(36, { vendedores: 1, dias: 10, seller: { medalha: 'platinum', uf: 'RS' } });

export const OCORRENCIAS = cards.reduce((n, c) => n + c.ocorrencias.length, 0);
export const ESTADO: EstadoBusca = {
  entrada: { tipoPagina: 'busca', url: 'https://lista.mercadolivre.com.br/cosmeticos' },
  resposta: { resultados, metadados: meta, precoDaMargem: {}, limiteEm: null, usoRegistrado: true, enriquecimento: ENR },
  observado: { cards, ocorrencias: OCORRENCIAS },
};
