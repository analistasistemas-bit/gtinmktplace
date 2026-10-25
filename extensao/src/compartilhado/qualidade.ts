// Qualidade do anúncio (ADR-0189 D-10, Task 17): regras locais puras sobre o que a página mostra.
// Mesmos limiares do Avant (relatório de RE); desconhecido nunca vira "ok" (consultor, 22/10).

/** Id de foto do ML (`610380-MLA115537568804_082026`): só ele vira URL ou seletor. */
export const ID_FOTO = /^\d{3,}-ML[A-Z]\d+_\d{6}$/;

export interface FotoAnuncio { id: string; largura: number | null; altura: number | null }

/** Lido da página (pdp.ts). null = não lido/ausente na página. */
export interface DadosQualidade {
  fotos: FotoAnuncio[] | null;
  /** Quantidade de Clips da galeria; null = galeria não lida. */
  clips: number | null;
  /** Caracteres da descrição; 0 = componente vazio; null = sem o componente. */
  descricao: number | null;
  /** Texto de garantia exibido (buy_benefits); null = não exibido. */
  garantia: string | null;
  /** Disponibilidade exibida pelo seletor de quantidade (indício, não estoque real). */
  disponivel: number | null;
  /** Texto do ML ao lado do seletor ("+50 disponíveis"); null = não exibido. Ausente em estado antigo. */
  disponivelTexto: string | null;
}

/** Texto de disponibilidade aceito ("+50 disponíveis", "1.000 disponíveis"). */
export const TEXTO_DISPONIVEL = /^\+?\d[\d.]*\s+disponíve/i;

export type EstadoItem = 'ok' | 'atencao' | 'nao_informado';
export interface ItemQualidade { chave: string; rotulo: string; estado: EstadoItem; valor: string }
export interface Qualidade { itens: ItemQualidade[]; atencao: number; fotosFracas: { id: string; posicao: number }[] }

const MIN_FOTOS = 5;
const MIN_LADO = 1200;
const MIN_DESCRICAO = 500;
const MIN_DISPONIVEL = 50;
const NAO_INFORMADO = (chave: string, rotulo: string, valor = 'Não informado'): ItemQualidade => ({ chave, rotulo, estado: 'nao_informado', valor });
const num = (n: number) => n.toLocaleString('pt-BR');

export function avaliarQualidade(d: DadosQualidade): Qualidade {
  const conhecidas = (d.fotos ?? []).map((f, i) => ({ ...f, posicao: i + 1 })).filter((f) => f.largura != null && f.altura != null);
  const fotosFracas = conhecidas.filter((f) => f.largura! < MIN_LADO || f.altura! < MIN_LADO).map(({ id, posicao }) => ({ id, posicao }));
  const itens: ItemQualidade[] = [
    d.fotos == null ? NAO_INFORMADO('fotos', 'Fotos')
      : { chave: 'fotos', rotulo: 'Fotos', estado: d.fotos.length < MIN_FOTOS ? 'atencao' : 'ok', valor: num(d.fotos.length) },
    d.fotos == null || d.fotos.length === 0 ? NAO_INFORMADO('resolucao', 'Resolução')
      : fotosFracas.length > 0
        ? { chave: 'resolucao', rotulo: 'Resolução', estado: 'atencao', valor: `${fotosFracas.length} abaixo de ${num(MIN_LADO)} px` }
        // Só é ok se todas as dimensões são conhecidas (desconhecida nunca prova resolução boa).
        : conhecidas.length === d.fotos.length
          ? { chave: 'resolucao', rotulo: 'Resolução', estado: 'ok', valor: `Todas com ${num(MIN_LADO)} px ou mais` }
          : NAO_INFORMADO('resolucao', 'Resolução'),
    d.clips == null ? NAO_INFORMADO('clips', 'Clips')
      : { chave: 'clips', rotulo: 'Clips', estado: d.clips > 0 ? 'ok' : 'atencao', valor: d.clips > 0 ? num(d.clips) : 'Sem Clips' },
    d.descricao == null ? NAO_INFORMADO('descricao', 'Descrição')
      : d.descricao === 0 ? { chave: 'descricao', rotulo: 'Descrição', estado: 'atencao', valor: 'Sem descrição' }
      : { chave: 'descricao', rotulo: 'Descrição', estado: d.descricao < MIN_DESCRICAO ? 'atencao' : 'ok', valor: `${num(d.descricao)} caracteres` },
    // Igual ao Avant: só o texto exato; ponto final aceito porque o ML termina os benefícios com ".".
    d.garantia == null ? NAO_INFORMADO('garantia', 'Garantia', 'Não informada')
      : /^Sem garantia\.?$/.test(d.garantia.trim())
        ? { chave: 'garantia', rotulo: 'Garantia', estado: 'atencao', valor: 'Sem garantia' }
        : { chave: 'garantia', rotulo: 'Garantia', estado: 'ok', valor: d.garantia.trim().replace(/\.$/, '') },
    d.disponivel == null ? NAO_INFORMADO('disponivel', 'Disponível')
      // Valor exibido = o do ML ("+50") quando a página mostra; o estado segue o número do seletor.
      : { chave: 'disponivel', rotulo: 'Disponível', estado: d.disponivel < MIN_DISPONIVEL ? 'atencao' : 'ok', valor: d.disponivelTexto?.match(/^\+?\d[\d.]*/)?.[0] ?? num(d.disponivel) },
  ];
  return { itens, atencao: itens.filter((i) => i.estado === 'atencao').length, fotosFracas };
}

const inteiroOuNulo = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null);

/** Forma recebida do content script (dado da página) → DadosQualidade saneado; forma inválida → null. */
export function normalizarQualidade(v: unknown): DadosQualidade | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const fotos = Array.isArray(o.fotos)
    ? o.fotos.slice(0, 60).flatMap((f) => {
      const x = f as Record<string, unknown> | null;
      return x && typeof x.id === 'string' && x.id.length <= 80
        ? [{ id: x.id, largura: inteiroOuNulo(x.largura, 20000), altura: inteiroOuNulo(x.altura, 20000) }]
        : [];
    })
    : null;
  return {
    fotos,
    clips: inteiroOuNulo(o.clips, 100),
    descricao: inteiroOuNulo(o.descricao, 100000),
    garantia: typeof o.garantia === 'string' && o.garantia.length <= 160 ? o.garantia : null,
    disponivel: inteiroOuNulo(o.disponivel, 10000000),
    disponivelTexto: typeof o.disponivelTexto === 'string' && o.disponivelTexto.length <= 40 && TEXTO_DISPONIVEL.test(o.disponivelTexto) ? o.disponivelTexto : null,
  };
}
