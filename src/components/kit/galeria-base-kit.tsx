// ADR-0204: fotos 2 a 7 do anúncio principal (base) na prévia do kit vinculado. Reaproveita a grade do kit com variação.
import { GaleriaPecas, type RotulosGaleria } from '@/components/kit-variacao/galeria-pecas';
import type { EscolhaGaleria, GaleriaProposta } from '@/lib/kit-galeria';

const TITULO = 'Fotos 2 a 7 do anúncio principal';
const ROTULOS: Partial<RotulosGaleria> = {
  carregando: 'Lendo as fotos do anúncio principal no Mercado Livre…',
  titulo: TITULO,
  indisponivelRodape: 'O kit sai só com a capa.',
  listaAria: `${TITULO} no kit`,
  sufixoNoAnuncio: (t) => ` · no kit: ${t} ${t === 1 ? 'foto' : 'fotos'} além da capa`,
  alt: (i) => `Foto ${i + 2} do anúncio principal`,
};
const MOLDURA = 'rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground';

interface Props {
  proposta: GaleriaProposta | undefined;
  escolha: EscolhaGaleria | undefined;
  onChange: (e: EscolhaGaleria) => void;
  carregando?: boolean;
  erro?: boolean;
  desabilitado?: boolean;
}

export function GaleriaBaseKit({ proposta, ...resto }: Props) {
  if (proposta?.avisos.includes('base_nao_publicada')) {
    return <p className={MOLDURA}>A base ainda não foi publicada: o kit sai só com a capa</p>;
  }
  if (proposta && !proposta.indisponivel && proposta.fotos.length === 0 && !resto.carregando && !resto.erro) {
    return <p className={MOLDURA}>A base não tem fotos além da capa</p>;
  }
  return <GaleriaPecas proposta={proposta} rotulos={ROTULOS} {...resto} />;
}
