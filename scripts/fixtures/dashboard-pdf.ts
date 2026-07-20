import { mkdirSync, writeFileSync } from 'node:fs';

import { gerarPdfDashboard } from '../../src/lib/export/pdf-dashboard';
import type { DashboardPdfVisual } from '../../src/lib/export/tipos';

const representativo: DashboardPdfVisual = {
  tipo: 'dashboard',
  periodo: 'Hoje',
  canal: 'Todos',
  metrica: 'faturamento',
  serie: [
    { rotulo: '18/07', valor: 218.4 },
    { rotulo: '19/07', valor: 342.9 },
    { rotulo: '20/07', valor: 456.56 },
  ],
  principais: [
    {
      label: 'Faturamento bruto',
      valor: 'R$ 456,56',
      delta: '+138% vs. anterior',
      tendencia: 'up',
      auxiliar: '9 pedidos · 11 unidades',
    },
    {
      label: 'Líquido das vendas',
      valor: 'R$ 319,55',
      delta: '+133% vs. anterior',
      tendencia: 'up',
      auxiliar: 'comissão R$ 52,35 · frete R$ 84,66',
    },
  ],
  secundarios: [
    { label: 'Líquido no faturamento', valor: 'R$ 276,98', delta: '+139% vs. anterior', tendencia: 'up' },
    { label: 'Markup no período', valor: '+35%', tendencia: 'up' },
    { label: 'Compradores', valor: '7', auxiliar: '33,3% recompra' },
    { label: 'Pedidos', valor: '9', delta: '+125% vs. anterior', tendencia: 'up' },
    { label: 'Ticket médio', valor: 'R$ 50,73', delta: '+6% vs. anterior', tendencia: 'up' },
    { label: 'A receber', valor: 'R$ 319,55', auxiliar: 'próxima em 18/08/2026' },
  ],
  alertas: ['1 lote a revisar', '1 anúncio com problema', '1 devolução aberta'],
  produtos: [
    {
      posicao: 1,
      titulo: 'Tecido Oxford Liso 10m | 100% Poliéster | Qualidade Premium',
      unidades: 5,
      faturamento: 280.8,
    },
    {
      posicao: 2,
      titulo: 'Cola Em Bastão 11mm Grossa 1kg | Adesão Firme',
      unidades: 2,
      faturamento: 75.8,
    },
    {
      posicao: 3,
      titulo:
        'Linha Charme Círculo 150gr Crochê Tricô 100% Algodão 396mts Cor Camafeu 3201 - título deliberadamente longo',
      unidades: 3,
      faturamento: 74.97,
    },
    {
      posicao: 4,
      titulo: 'Fio Charme Círculo 150g | 100% Algodão Mercerizado',
      unidades: 1,
      faturamento: 24.99,
    },
  ],
  liberacoes: [{ data: '18/08', valor: 319.55 }],
  geografia: [
    { uf: 'MG', pedidos: 4, participacao: 44.4 },
    { uf: 'TO', pedidos: 1, participacao: 11.1 },
    { uf: 'BA', pedidos: 1, participacao: 11.1 },
    { uf: 'MT', pedidos: 1, participacao: 11.1 },
    { uf: 'SC', pedidos: 1, participacao: 11.1 },
  ],
  semLocalizacao: 1,
};

const vazio: DashboardPdfVisual = {
  ...representativo,
  metrica: 'pedidos',
  serie: [],
  alertas: [],
  produtos: [],
  liberacoes: [],
  geografia: [],
  semLocalizacao: 0,
};

mkdirSync('tmp/pdfs', { recursive: true });

for (const [nome, data] of Object.entries({ representativo, vazio })) {
  const doc = gerarPdfDashboard(data, new Date('2026-07-20T10:31:00-03:00'));
  writeFileSync(`tmp/pdfs/dashboard-${nome}.pdf`, Buffer.from(doc.output('arraybuffer')));
}
