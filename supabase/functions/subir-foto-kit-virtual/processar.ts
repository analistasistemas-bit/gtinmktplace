// ADR-0154 D-5 / ADR-0033: sobe a foto do Kit Virtual ao ML no momento do upload no diálogo, não
// no clique de publicar — a propagação de foto no ML é assíncrona e um `picture_id` recém-criado
// costuma ser recusado por minutos num POST subsequente. `criar-kit-virtual` mantém o upload como
// fallback (rede de segurança) quando esta edge falha ou não roda.
//
// Módulo puro (sem fetch, sem Supabase) para ser testável sem HTTP — mesmo padrão de
// buscar-componentes-kit-virtual/processar.ts; `index.ts` injeta as implementações reais.
import { ehPreviaReprovada, fotoDaOrg } from '../criar-kit-variacao/processar.ts';
import { ehCapaIaKitVirtual } from '../criar-kit-virtual/processar.ts';

export interface SubirFotoKitVirtualInput {
  fotoStoragePath: string;
}

export type MotivoSubirFotoKitVirtual = 'path_invalido' | 'falha_leitura' | 'falha_url_assinada' | 'falha_upload_ml';

export type ResultadoSubirFotoKitVirtual =
  | { ok: true; pictureId: string }
  | { ok: false; motivo: MotivoSubirFotoKitVirtual; mensagem?: string };

export interface SubirFotoKitVirtualDeps {
  orgId: string;
  /** Usuários da org (pasta legada do upload manual); a foto só sai do bucket se for da org. */
  usuariosDaOrg: Set<string>;
  /** URL assinada da foto no storage; `null` quando o path não resolve. */
  urlAssinadaFoto: (path: string) => Promise<string | null>;
  subirFoto: (sourceUrl: string) => Promise<string>;
  /** Capa IA (`/kit-virtual-ia/`) com entrega faturada (`kit_variacao_imagens.status='gerada'`) na org. Lança em falha de leitura. */
  capaIaGerada: (path: string) => Promise<boolean>;
}

/** Recusa que não custa rede. Roda ANTES de qualquer chamada externa. */
export function validarSubirFotoKitVirtual(
  input: SubirFotoKitVirtualInput, orgId: string, usuariosDaOrg: Set<string>,
): MotivoSubirFotoKitVirtual | null {
  if (typeof input.fotoStoragePath !== 'string' || !input.fotoStoragePath.trim()) return 'path_invalido';
  // A URL é assinada com a service role: path de outra org vazaria a foto dela para o ML.
  // Prévia reprovada da capa IA (`-tN`) também nunca vira foto do kit.
  if (!fotoDaOrg(input.fotoStoragePath, orgId, usuariosDaOrg) || ehPreviaReprovada(input.fotoStoragePath)) return 'path_invalido';
  return null;
}

export async function subirFotoKitVirtual(
  deps: SubirFotoKitVirtualDeps, input: SubirFotoKitVirtualInput,
): Promise<ResultadoSubirFotoKitVirtual> {
  const invalido = validarSubirFotoKitVirtual(input, deps.orgId, deps.usuariosDaOrg);
  if (invalido) return { ok: false, motivo: invalido };

  // I1: capa IA sem entrega faturada (linha presa em `pendente_upload`, ou de outra org) nunca sai do bucket.
  if (ehCapaIaKitVirtual(input.fotoStoragePath)) {
    try {
      if (!await deps.capaIaGerada(input.fotoStoragePath)) return { ok: false, motivo: 'path_invalido' };
    } catch (e) {
      return { ok: false, motivo: 'falha_leitura', mensagem: e instanceof Error ? e.message : String(e) };
    }
  }

  let url: string | null;
  try {
    url = await deps.urlAssinadaFoto(input.fotoStoragePath);
  } catch (e) {
    return { ok: false, motivo: 'falha_url_assinada', mensagem: e instanceof Error ? e.message : String(e) };
  }
  if (!url) return { ok: false, motivo: 'falha_url_assinada', mensagem: 'não foi possível gerar a URL da foto' };

  try {
    const pictureId = await deps.subirFoto(url);
    return { ok: true, pictureId };
  } catch (e) {
    return { ok: false, motivo: 'falha_upload_ml', mensagem: e instanceof Error ? e.message : String(e) };
  }
}
