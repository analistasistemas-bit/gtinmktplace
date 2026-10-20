// Aba Campanhas do /ads (emenda ADR-0179, 2026-10-20): agrupa os anúncios patrocinados por família do PubliAI e
// calcula os 3 alertas. Puro. Tipos vêm da edge (fonte única do contrato), só como `import type`.
import type {
  AnuncioPatrocinado, CampanhaAds, RespostaCampanhas,
} from '../../supabase/functions/_shared/ads/campanhas';

export type { AnuncioPatrocinado, CampanhaAds, Equilibrio, ItemAgora, RespostaCampanhas } from '../../supabase/functions/_shared/ads/campanhas';
export type RespostaCampanhasOk = Extract<RespostaCampanhas, { estado: 'ok' }>;

export type AlertaCampanha = 'roas_acima_margem' | 'patrocinado_parado' | 'parcialmente_patrocinada';
export interface FamiliaCampanha {
  codigoPai: string; nome: string | null; anuncios: AnuncioPatrocinado[];
  equilibrioPct: number | null; motivoEquilibrio: string | null; patrocinados: number; publicados: number;
  alertas: AlertaCampanha[];
}
export interface CampanhaVista extends CampanhaAds {
  familias: FamiliaCampanha[]; foraDoPubliai: AnuncioPatrocinado[]; totalAlertas: number;
}

export const ROTULO_ALERTA: Record<AlertaCampanha, string> = {
  roas_acima_margem: 'ROAS objetivo acima da margem',
  patrocinado_parado: 'Patrocinado parado',
  parcialmente_patrocinada: 'Parcialmente patrocinada',
};

export const ROTULO_MOTIVO: Record<string, string> = {
  sem_cadastro: 'Variação não encontrada no cadastro',
  pacote_a_conferir: 'Pacote a conferir no cadastro',
  sem_custo: 'Sem custo cadastrado',
  sem_origem: 'Sem origem (nacional/importado)',
  sem_dimensao: 'Sem medidas do pacote',
  sem_preco: 'Sem preço no anúncio',
  sem_categoria: 'Sem categoria',
  erro_tarifa: 'Tarifa indisponível',
  erro_item: 'Anúncio indisponível no ML',
  sem_aliquota: 'Alíquotas não confirmadas',
  fora_da_projecao: 'Fora da projeção',
  kit_divergente: 'Kit divergente do cadastro',
  kit_ambiguo: 'Kit ambíguo',
  kit_sem_dimensao: 'Kit sem medidas',
};

/** Mesmo critério de `bucketDoGrupo` (ads-painel.ts): todos os códigos do MLB numa única família. */
function familiaDoMlb(mlb: string, codigosPorMlb: Map<string, string[]>, familiaDoCodigo: Map<string, string>): string | null {
  const cods = codigosPorMlb.get(mlb) ?? [];
  if (!cods.length) return null;
  const fams = new Set<string>();
  for (const c of cods) {
    const f = familiaDoCodigo.get(c);
    if (f == null) return null;
    fams.add(f);
  }
  return fams.size === 1 ? [...fams][0] : null;
}

export function montarCampanhas(p: {
  resposta: RespostaCampanhasOk;
  codigosPorMlb: Map<string, string[]>;
  familiaDoCodigo: Map<string, string>;
  nomeDaFamilia: Map<string, string>;
}): CampanhaVista[] {
  const { resposta, codigosPorMlb, familiaDoCodigo, nomeDaFamilia } = p;
  const ativas = new Set(resposta.campanhas.filter((c) => c.status === 'active').map((c) => c.id));
  const patrocinadosAtivos = new Set(resposta.anuncios.filter((a) => ativas.has(a.campanhaId)).map((a) => a.mlb));

  return resposta.campanhas.map((c) => {
    const porFamilia = new Map<string, AnuncioPatrocinado[]>();
    const foraDoPubliai: AnuncioPatrocinado[] = [];
    for (const a of resposta.anuncios) {
      if (a.campanhaId !== c.id) continue;
      const fam = familiaDoMlb(a.mlb, codigosPorMlb, familiaDoCodigo);
      if (fam == null) { foraDoPubliai.push(a); continue; }
      const l = porFamilia.get(fam);
      if (l) l.push(a); else porFamilia.set(fam, [a]);
    }
    const ativa = c.status === 'active';
    const familias: FamiliaCampanha[] = [...porFamilia].map(([codigoPai, anuncios]) => {
      const semRef = anuncios.find((a) => a.equilibrio.acosPct == null);
      const equilibrioPct = semRef ? null : Math.min(...anuncios.map((a) => a.equilibrio.acosPct!));
      const publicadosLista = resposta.publicadosPorFamilia?.[codigoPai] ?? [];
      const alertas: AlertaCampanha[] = [];
      if (ativa) {
        if (c.acosObjetivo != null && equilibrioPct != null && c.acosObjetivo > equilibrioPct) alertas.push('roas_acima_margem');
        if (anuncios.some((a) => a.item != null && (a.item.status !== 'active' || a.item.estoque === 0))) alertas.push('patrocinado_parado');
        if (resposta.publicadosPorFamilia != null && publicadosLista.some((m) => !patrocinadosAtivos.has(m))) alertas.push('parcialmente_patrocinada');
      }
      return {
        codigoPai, nome: nomeDaFamilia.get(codigoPai) ?? null, anuncios, equilibrioPct,
        motivoEquilibrio: semRef ? semRef.equilibrio.motivo : null,
        patrocinados: publicadosLista.filter((m) => patrocinadosAtivos.has(m)).length,
        publicados: publicadosLista.length, alertas,
      };
    }).sort((a, b) =>
      Number(b.alertas.length > 0) - Number(a.alertas.length > 0)
      || (a.nome === null ? 1 : 0) - (b.nome === null ? 1 : 0)
      || (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')
      || a.codigoPai.localeCompare(b.codigoPai));
    return { ...c, familias, foraDoPubliai, totalAlertas: familias.reduce((s, f) => s + f.alertas.length, 0) };
  });
}
