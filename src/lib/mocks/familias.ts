import type { Familia, OperacaoML, Concorrencia, EstrategiaPreco, Variacao } from './types';

const CORES: Array<{ nome: string; hex: string }> = [
  { nome: 'Preto', hex: '#000000' },
  { nome: 'Branco', hex: '#ffffff' },
  { nome: 'Vermelho', hex: '#dc2626' },
  { nome: 'Azul Royal', hex: '#1e40af' },
  { nome: 'Verde Bandeira', hex: '#15803d' },
  { nome: 'Amarelo', hex: '#facc15' },
  { nome: 'Rosa Pink', hex: '#ec4899' },
  { nome: 'Cinza', hex: '#6b7280' },
  { nome: 'Marrom', hex: '#78350f' },
  { nome: 'Roxo', hex: '#7e22ce' },
  { nome: 'Laranja', hex: '#ea580c' },
  { nome: 'Cru', hex: '#e7d8c1' },
];

interface FamiliaTemplate {
  prefixoTitulo: string;
  descricaoBase: string;
  precoBase: number;
  precoVariacao: number;
}

const TEMPLATES: FamiliaTemplate[] = [
  ...Array.from({ length: 30 }, (_, i) => ({
    prefixoTitulo: 'Linha de Costura Algodão 500m',
    descricaoBase: 'Linha 100% algodão mercerizado, 500m, ideal para máquina doméstica. Cone industrial.',
    precoBase: 8.9 + (i % 5) * 0.5,
    precoVariacao: 3.6,
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    prefixoTitulo: `Botão Plástico ${10 + i}mm`,
    descricaoBase: 'Botão de plástico com 4 furos, ideal para roupas infantis e adultas.',
    precoBase: 0.15 + i * 0.02,
    precoVariacao: 0.1,
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    prefixoTitulo: `Fita ${i % 2 === 0 ? 'Cetim' : 'Gorgurão'} 10mm`,
    descricaoBase: 'Fita 10mm para acabamentos e decoração. Rolo com 50 metros.',
    precoBase: 2.4,
    precoVariacao: 0.5,
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    prefixoTitulo: `Zíper Nylon #${3 + i} 15cm`,
    descricaoBase: 'Zíper nylon resistente, ideal para confecções e reparos.',
    precoBase: 1.8 + i * 0.3,
    precoVariacao: 1.4,
  })),
];

function gerarVariacoes(codigoPai: string, quantidade: number, precoBase: number, precoVariacao: number): Variacao[] {
  return Array.from({ length: quantidade }, (_, idx) => {
    const cor = CORES[idx % CORES.length];
    return {
      codigo: `${codigoPai}-${String(idx + 1).padStart(2, '0')}`,
      cor: cor.nome,
      corHex: cor.hex,
      preco: Math.round((precoBase + (idx / quantidade) * precoVariacao) * 100) / 100,
      estoque: Math.max(0, 50 - idx * 3),
    };
  });
}

function gerarFamilia(idx: number, template: FamiliaTemplate): Familia {
  const numeroPai = 1043812 + idx;
  const codigoPai = String(numeroPai);
  const quantidadeCores = 3 + (idx % 10);
  const variacoes = gerarVariacoes(codigoPai, quantidadeCores, template.precoBase, template.precoVariacao);
  const precoMin = Math.min(...variacoes.map((v) => v.preco));
  const precoMax = Math.max(...variacoes.map((v) => v.preco));

  const operacao: OperacaoML = idx < 38 ? 'CREATE' : 'UPDATE';
  const concorrencia: Concorrencia =
    idx % 10 === 0 ? 'alta' : idx % 10 < 5 ? 'moderada' : 'sem';
  const precoAbaixo20pc = idx === 5 || idx === 15 || idx === 25;
  const estrategiaPreco: EstrategiaPreco = concorrencia === 'sem' ? 'PROPRIO' : 'COMPETITIVO';
  const estrategiaMotivo =
    estrategiaPreco === 'PROPRIO'
      ? 'Nenhum concorrente com mesmo GTIN — manter preço da planilha'
      : `Concorrência ${concorrencia}: alinhar com mediana do mercado`;
  const editadoPeloOperador = idx === 2 || idx === 7;

  return {
    id: `familia-lote42-${String(idx + 1).padStart(2, '0')}`,
    loteId: 'lote-42',
    codigoPai,
    titulo: template.prefixoTitulo,
    descricao: template.descricaoBase,
    operacao,
    estrategiaPreco,
    estrategiaMotivo,
    concorrencia,
    precoMin,
    precoMax,
    precoAbaixo20pc,
    variacoes,
    editadoPeloOperador,
  };
}

export const MOCK_FAMILIAS: Familia[] = TEMPLATES.map((tpl, idx) => gerarFamilia(idx, tpl));
