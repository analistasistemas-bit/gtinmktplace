import type { Rotulo } from '@/lib/vitrine';

// Textos aprovados (spec 2026-10-03, Apêndice). Cada frase de "Como ler" é um item.
export const DICAS: Record<'visitas' | 'conversao' | 'vendaPorVisita' | 'grafico', { oQueE: string; comoLer: string[] }> = {
  visitas: {
    oQueE: 'Total de visitas de todos os anúncios no período',
    comoLer: [
      '▲ entrou mais gente que no período anterior.',
      '▲ aqui e ▼ em Conversão: chegou tráfego que não compra.',
      '▼ aqui com Conversão estável: falta exposição (Ads, posição).',
    ],
  },
  conversao: {
    oQueE: 'De cada 100 visitas, quantas viraram pedido',
    comoLer: [
      '3,6% = ~36 pedidos a cada 1.000 visitas.',
      'O Δ é em pontos percentuais (+0,10 p.p. = de 3,5% para 3,6%).',
      'Queda com visitas estáveis aponta preço, foto ou concorrência.',
    ],
  },
  vendaPorVisita: {
    oQueE: 'Quanto cada visita rendeu em vendas (R$)',
    comoLer: [
      'Junta conversão e ticket médio: sobe com mais conversão ou com venda mais cara.',
      'Bom para comparar meses de volumes diferentes.',
    ],
  },
  grafico: {
    oQueE: 'Visitas por dia (média da semana) e conversão semanal',
    comoLer: [
      'As duas sobem: melhorando.',
      'Barra sobe e linha cai: tráfego que não compra.',
      'Barra cai e linha se mantém: o problema é exposição, não o anúncio.',
      'Semana em branco: dados insuficientes.',
    ],
  },
};

export const LEGENDA: { rotulo: Rotulo; significa: string; fazer: string; porQue: string }[] = [
  { rotulo: 'invisivel', significa: 'Ativo, recebia visitas e zerou nos últimos 7 dias',
    fazer: 'Ver se foi moderado ou perdeu indexação no ML — é o mais urgente',
    porQue: 'Pelo ritmo do período, esperava ≥ 3 visitas em 7 dias e teve 0' },
  { rotulo: 'sem_venda', significa: 'Muita visita e conversão bem abaixo da média',
    fazer: 'Revisar preço, foto principal e título',
    porQue: '≥ 100 visitas e conversão < metade da média da conta' },
  { rotulo: 'converte', significa: 'Converte bem acima da média, mas tem pouca visita',
    fazer: 'Colocar em Ads (o selo diz se já está)',
    porQue: '≥ 5 pedidos, conversão ≥ 1,5× a média e visitas abaixo de 3/4 dos anúncios que vendem' },
  { rotulo: 'perdendo', significa: 'Caiu mais de 30% de visitas contra o período anterior',
    fazer: 'Ver concorrência e preço',
    porQue: '≥ 100 visitas no período anterior e queda > 30%' },
];
