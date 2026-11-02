// Dados FICTÍCIOS para a prova visual da busca (Task 6). Nenhum token, nenhuma chamada de rede.
// 60 produtos / 68 ocorrências: 8 produtos aparecem 2x (orgânico + patrocinado, preços diferentes).
import type { EstadoBusca } from '../src/busca-sw';
import type { CardBusca, OcorrenciaBusca } from '../src/leitura/busca';
import type { MetadadosCardBusca, ResultadoCard } from '../../supabase/functions/_shared/extensao/busca.ts';

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

export const OCORRENCIAS = cards.reduce((n, c) => n + c.ocorrencias.length, 0);
export const ESTADO: EstadoBusca = {
  entrada: { tipoPagina: 'busca', url: 'https://lista.mercadolivre.com.br/cosmeticos' },
  resposta: { resultados, metadados: meta, precoDaMargem: {}, limiteEm: null, usoRegistrado: true },
  observado: { cards, ocorrencias: OCORRENCIAS },
};
