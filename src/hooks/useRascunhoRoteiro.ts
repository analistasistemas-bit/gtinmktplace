// Galeria IA, Fase B (plano 2026-11-11, Ajuste v2-5): estado do rascunho do roteiro, sem layout.
// - Salvamento automático com debounce, SÓ em rascunho: no servidor, salvar roteiro aprovado/desatualizado cria a
//   versão N+1 (`galeria-roteiro`, ação salvar); por isso a edição de aprovado passa pelo "Editar" explícito.
// - Um salvar em voo por vez, comparado por snapshot (o formulário nunca trava); edição feita durante o voo não é
//   sobrescrita pela resposta e sai no salvar seguinte.
// - Resposta de uma abertura antiga (recarga, troca de roteiro) é descartada.
// - `descarregar` manda o pendente na hora (troca de passo, voltar a Publicados, antes de aprovar); desmontar também.
// - A ciência dos dados sem etiqueta não zera quando o salvar responde (defeito do passo antigo).
import { useCallback, useEffect, useRef, useState } from 'react';
import { mensagemErro, salvarRoteiro, type Res, type RespostaRoteiro, type Roteiro } from '@/lib/galeria/api';
import { paraEnvio, snapshot } from '@/lib/galeria/rascunho';

export type EstadoSalvamento = 'salvo' | 'pendente' | 'salvando' | 'erro';
type Falha = Extract<Res<unknown>, { ok: false }>;

const ATRASO_MS = 800;

export function useRascunhoRoteiro({ mlItemId, familiaId, resp, podeEditar, aoResposta, aoFalhar, atrasoMs = ATRASO_MS }: {
  mlItemId: string;
  familiaId: string;
  resp: RespostaRoteiro | null;
  /** Só admin edita e aprova; os demais veem o roteiro em leitura (Ajuste v2-5). */
  podeEditar: boolean;
  aoResposta: (r: RespostaRoteiro) => void;
  /** Falha do salvar: o pai traduz e recarrega quando o erro muda o chão (família, categoria, conteúdo). */
  aoFalhar: (f: Falha) => void;
  atrasoMs?: number;
}) {
  const [rascunho, setRascunhoState] = useState<Roteiro | null>(resp?.roteiro.conteudo ?? null);
  const [estado, setEstadoState] = useState<EstadoSalvamento>('salvo');
  const [erro, setErro] = useState<string | null>(null);
  const [ciente, setCiente] = useState<ReadonlySet<string>>(new Set());

  const rascunhoRef = useRef(rascunho);
  const estadoRef = useRef(estado);
  const respRef = useRef(resp);
  /** Snapshot que o servidor já tem. */
  const confirmadoRef = useRef<string | null>(resp ? snapshot(resp.roteiro.conteudo) : null);
  /** Abertura em curso: resposta de outra é descartada. */
  const geracaoRef = useRef(0);
  /** A resposta que o próprio hook entregou ao pai (o eco não reinicia o rascunho). */
  const propriaRef = useRef<RespostaRoteiro | null>(null);
  const vooRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const podeEditarRef = useRef(podeEditar);
  podeEditarRef.current = podeEditar;
  const cbRef = useRef({ aoResposta, aoFalhar });
  cbRef.current = { aoResposta, aoFalhar };

  const setRascunho = (r: Roteiro | null) => { rascunhoRef.current = r; setRascunhoState(r); };
  const setEstado = (e: EstadoSalvamento) => { estadoRef.current = e; setEstadoState(e); };
  const sujo = () => !!rascunhoRef.current && snapshot(rascunhoRef.current) !== confirmadoRef.current;
  const emRascunho = () => respRef.current?.roteiro.status === 'rascunho';

  // Resposta nova vinda de fora (abertura, recarga, "Editar"): reinicia o rascunho; o eco do próprio salvar, não.
  useEffect(() => {
    respRef.current = resp;
    if (resp && resp === propriaRef.current) return;
    geracaoRef.current += 1;
    clearTimeout(timerRef.current);
    const c = resp?.roteiro.conteudo ?? null;
    setRascunho(c);
    confirmadoRef.current = c ? snapshot(c) : null;
    setEstado('salvo');
    setErro(null);
  }, [resp]);

  const enviar = useCallback(async (): Promise<void> => {
    clearTimeout(timerRef.current);
    while (vooRef.current) await vooRef.current;
    const r = respRef.current;
    const atual = rascunhoRef.current;
    if (!r || !atual || !emRascunho() || !podeEditarRef.current) return;
    const enviado = snapshot(atual);
    if (enviado === confirmadoRef.current) { setEstado('salvo'); return; }
    const g = geracaoRef.current;
    setEstado('salvando'); setErro(null);
    const voo = (async () => {
      const res = await salvarRoteiro(mlItemId, familiaId, r.roteiro.id, paraEnvio(atual));
      if (g !== geracaoRef.current) return;
      if (!res.ok) {
        setEstado('erro'); setErro(mensagemErro(res.erro));
        cbRef.current.aoFalhar(res);
        return;
      }
      confirmadoRef.current = enviado;
      propriaRef.current = res.dados;
      respRef.current = res.dados;
      // Conteúdo saneado pelo servidor só entra se nada foi digitado durante o voo.
      if (snapshot(rascunhoRef.current ?? atual) === enviado) {
        setRascunho(res.dados.roteiro.conteudo);
        confirmadoRef.current = snapshot(res.dados.roteiro.conteudo);
      }
      cbRef.current.aoResposta(res.dados);
    })();
    const marcado: Promise<void> = voo.finally(() => { if (vooRef.current === marcado) vooRef.current = null; });
    vooRef.current = marcado;
    await marcado;
    if (g !== geracaoRef.current || estadoRef.current === 'erro') return;
    if (sujo()) await enviar(); else setEstado('salvo');
  }, [mlItemId, familiaId]);

  const editavel = podeEditar && resp?.roteiro.status === 'rascunho';

  const editar = useCallback((fn: (r: Roteiro) => Roteiro) => {
    const atual = rascunhoRef.current;
    if (!atual || !emRascunho() || !podeEditarRef.current) return;
    setRascunho(fn(atual));
    if (estadoRef.current !== 'salvando') setEstado('pendente');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void enviar(); }, atrasoMs);
  }, [enviar, atrasoMs]);

  /** Manda o pendente agora. true = o servidor tem o que está na tela. */
  const descarregar = useCallback(async (): Promise<boolean> => {
    await enviar();
    return estadoRef.current !== 'erro' && !sujo();
  }, [enviar]);

  /** Roteiro aprovado (ou desatualizado): a edição vira a versão seguinte, em rascunho, por ação explícita. */
  const editarAprovado = useCallback(async () => {
    const r = respRef.current;
    if (!r || emRascunho() || !podeEditarRef.current) return;
    const g = geracaoRef.current;
    setEstado('salvando'); setErro(null);
    const res = await salvarRoteiro(mlItemId, familiaId, r.roteiro.id, paraEnvio(r.roteiro.conteudo));
    if (g !== geracaoRef.current) return;
    if (!res.ok) { setEstado('erro'); setErro(mensagemErro(res.erro)); cbRef.current.aoFalhar(res); return; }
    // Não é eco: id novo → o efeito reinicia o rascunho e a geração.
    cbRef.current.aoResposta(res.dados);
  }, [mlItemId, familiaId]);

  // Saída: o pendente sai antes (HashRouter não tem `useBlocker`); fechar a aba só avisa.
  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => { if (sujo() || vooRef.current) e.preventDefault(); };
    window.addEventListener('beforeunload', aviso);
    return () => {
      window.removeEventListener('beforeunload', aviso);
      if (sujo()) void enviar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendentes = resp?.ciencia_pendente ?? [];
  const marcarCiencia = useCallback((v: boolean) => {
    setCiente((s) => { const n = new Set(s); for (const c of respRef.current?.ciencia_pendente ?? []) { if (v) n.add(c); else n.delete(c); } return n; });
  }, []);

  /** Última resposta do servidor (id e pendências de ciência vigentes depois de um `descarregar`). */
  const atual = useCallback(() => respRef.current, []);

  return {
    rascunho, editavel, estado, erro, editar, descarregar, editarAprovado, atual,
    tentarDeNovo: enviar,
    ciente, marcarCiencia, faltaCiencia: pendentes.some((c) => !ciente.has(c)),
  };
}
