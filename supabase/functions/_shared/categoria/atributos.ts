import type { TipoAviamento } from './detectar.ts';

export interface AtributoML {
  id: string;
  value_name?: string;
  value_id?: string;
}

// Marca fixa da empresa (decisão de negócio do Diego, 2026-06-01).
const MARCA = 'Avil';

// Categorias-folha reais do ML (validadas via API em 2026-06-01). Ver Adendo do ADR-0009.
const CATEGORIA_POR_TIPO: Record<TipoAviamento, string | null> = {
  linha: 'MLB270273', // Fios e Cadarços de Armarinho
  fita: 'MLB255054',  // Fitas de Cetim
  botao: 'MLB270272', // Botões
  outro: null,        // operador escolhe na revisão
};

// value_id dos valores fixos de RIBBON_TYPE (categoria fita).
const RIBBON_TYPE: { termo: string; id: string }[] = [
  { termo: 'cetim', id: '22691458' },
  { termo: 'gorgorao', id: '22691455' },
  { termo: 'gorgurao', id: '22691455' },
  { termo: 'organza', id: '22691457' },
  { termo: 'veludo', id: '22691459' },
  { termo: 'renda', id: '21206106' },
  { termo: 'vies', id: '5038983' },
  { termo: 'estampada', id: '22691454' },
];
const RIBBON_TYPE_DEFAULT = '22691456'; // "Fita"

// value_id de MATERIAL (categoria botão): Acrílico (default) ou Madeira.
const MATERIAL_ACRILICO = '1258137';
const MATERIAL_MADEIRA = '2431881';

// Atributos obrigatórios por categoria (tags required na API ML). COLOR é
// atributo de variação (montado na publicação a partir de variacoes.cor).
const OBRIGATORIOS: Record<TipoAviamento, string[]> = {
  linha: ['BRAND', 'MODEL'],
  fita: ['BRAND', 'RIBBON_TYPE'],
  botao: ['BRAND', 'MATERIAL'],
  outro: [],
};

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function categoriaParaTipo(tipo: TipoAviamento): string | null {
  return CATEGORIA_POR_TIPO[tipo];
}

/** Monta os atributos obrigatórios da categoria a partir do nome (ADR-0009). */
export function montarAtributosML(tipo: TipoAviamento, nome: string): AtributoML[] {
  const texto = normalizar(nome ?? '');
  switch (tipo) {
    case 'linha':
      return [
        { id: 'BRAND', value_name: MARCA },
        { id: 'MODEL', value_name: nome },
      ];
    case 'fita': {
      const match = RIBBON_TYPE.find((r) => texto.includes(r.termo));
      return [
        { id: 'BRAND', value_name: MARCA },
        { id: 'RIBBON_TYPE', value_id: match?.id ?? RIBBON_TYPE_DEFAULT },
      ];
    }
    case 'botao':
      return [
        { id: 'BRAND', value_name: MARCA },
        { id: 'MATERIAL', value_id: texto.includes('madeira') ? MATERIAL_MADEIRA : MATERIAL_ACRILICO },
      ];
    default:
      return [];
  }
}

/** Lista os obrigatórios ausentes (validação pré-publicação). 'outro' → ['CATEGORIA']. */
export function atributosFaltantes(tipo: TipoAviamento, atributos: AtributoML[]): string[] {
  if (categoriaParaTipo(tipo) == null) return ['CATEGORIA'];
  const presentes = new Set(
    atributos.filter((a) => a.value_name || a.value_id).map((a) => a.id),
  );
  return OBRIGATORIOS[tipo].filter((id) => !presentes.has(id));
}
