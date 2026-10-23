// Bloco "Radar do Pulse" (ADR-0189 D-2/D-10, Task 18): o que o Pulse já coletou para este catálogo (só leitura) e, fora
// do radar, "Adicionar ao radar" (ação manual) que envia só o id de catálogo. Some com o módulo Pulse desligado.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertaRadar, RespostaRadar } from '../../../supabase/functions/_shared/extensao/radar.ts';
import { brl, mensagemDeErro, URL_APP, type Chamar } from './formato';

type NoRadar = Extract<RespostaRadar, { noRadar: true }>;
type Estado =
  | { tipo: 'carregando' } | { tipo: 'oculto' } | { tipo: 'erro'; mensagem: string }
  | { tipo: 'fora'; confirmando: boolean; enviando: boolean; aviso: string | null }
  | { tipo: 'no_radar'; dados: NoRadar; aviso: string | null };

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const preco = (n: number | null) => (n === null ? '' : ` ${brlJunto(n)}`);

const brlJunto = (n: number) => brl(n).replace(' ', '\u00a0'); // "R$" não fica sozinho no fim da linha

function textoAlerta(a: AlertaRadar): string {
  // O Pulse mede a queda no menor preço RELEVANTE (ofertas comparáveis), não no menor observado acima.
  if (a.tipo === 'preco_caiu') return a.de !== null && a.para !== null ? `Menor preço relevante caiu de ${brlJunto(a.de)} para ${brlJunto(a.para)}` : 'Menor preço relevante caiu';
  const quem = a.vendedor ?? 'Um vendedor';
  return a.tipo === 'novo_concorrente' ? `Novo concorrente: ${quem}${preco(a.preco)}` : `Saiu do catálogo: ${quem}${preco(a.preco)}`;
}

export function Radar({ catalogProductId, chamar }: { catalogProductId: string; chamar: Chamar }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  // Só a última requisição vale (StrictMode, recarga depois de adicionar); troca de catálogo remonta pela `key`.
  const seq = useRef(0);
  useEffect(() => () => { seq.current++; }, []);
  // Região de status sempre montada: o leitor de tela anuncia a troca de texto (sucesso, aviso, erro).
  const [anuncio, setAnuncio] = useState('');
  // Foco: depois de uma ação no bloco, o controle focado some; o foco vai ao controle principal do estado novo
  // (data-foco), a menos que a pessoa já tenha levado o foco para outro lugar.
  const raiz = useRef<HTMLElement>(null);
  const focoNoBloco = useRef(false);
  const agir = () => { focoNoBloco.current = document.hasFocus() && !!raiz.current?.contains(document.activeElement); };
  const confirmando = estado.tipo === 'fora' && estado.confirmando;
  useEffect(() => {
    if (!focoNoBloco.current) return;
    const ativo = document.activeElement;
    // Foco levado para fora do bloco depois da ação: não puxa de volta. (focus() não rouba o foco de outra janela.)
    if (ativo && ativo !== document.body && !raiz.current?.contains(ativo)) { focoNoBloco.current = false; return; }
    raiz.current?.querySelector<HTMLElement>('[data-foco]:not([disabled])')?.focus();
  }, [estado.tipo, confirmando]);

  const carregar = useCallback(async (aviso: string | null = null) => {
    const minha = ++seq.current;
    const r = await chamar<RespostaRadar>({ acao: 'radar', catalogProductId });
    if (minha !== seq.current) return;
    if (!r?.ok) { const mensagem = mensagemDeErro(r?.erro ?? 'interno'); setAnuncio(mensagem); setEstado({ tipo: 'erro', mensagem }); return; }
    const d = r.dados;
    if (!d?.modulo) setEstado({ tipo: 'oculto' }); // resposta fora do contrato: bônus some, não quebra o painel
    else if (!d.noRadar) setEstado({ tipo: 'fora', confirmando: false, enviando: false, aviso });
    else setEstado({ tipo: 'no_radar', dados: d, aviso });
    if (aviso) setAnuncio(aviso);
  }, [catalogProductId, chamar]);
  useEffect(() => { void carregar(); }, [carregar]);

  const avisar = (aviso: string) => { setAnuncio(aviso); setEstado({ tipo: 'fora', confirmando: false, enviando: false, aviso }); };
  const adicionar = async () => {
    agir();
    setEstado({ tipo: 'fora', confirmando: true, enviando: true, aviso: null });
    const r = await chamar<{ estado: string; jaExistia?: boolean; motivo?: string }>({ acao: 'adicionar_radar', catalogProductId });
    if (!r?.ok) { avisar(mensagemDeErro(r?.erro ?? 'interno')); return; }
    if (r.dados.estado === 'ok') { void carregar(r.dados.jaExistia ? 'Este catálogo já estava no radar.' : 'Adicionado ao radar.'); return; }
    avisar(r.dados.estado === 'ficha_inexistente' ? 'O Mercado Livre não encontrou esta ficha de catálogo.' : r.dados.motivo ?? 'Não foi possível adicionar agora.');
  };

  if (estado.tipo === 'oculto') return null;
  return (
    <section ref={raiz} className="cartao quanto-vende radar" aria-labelledby="rd-titulo" aria-busy={estado.tipo === 'carregando' || undefined}>
      <p className="ql-sr" role="status" aria-live="polite">{anuncio}</p>
      <div className="qv-cabeca">
        <h2 id="rd-titulo">Radar do Pulse</h2>
        {estado.tipo === 'no_radar' && (
          <span className={`rd-status ${estado.dados.status}`}>{estado.dados.status === 'ativo' ? 'No radar' : 'Pausado'}</span>
        )}
      </div>

      {estado.tipo === 'carregando' && <p className="nota">Consultando o radar…</p>}

      {estado.tipo === 'erro' && (
        <div className="rd-erro">
          <span>{estado.mensagem}</span>
          <button type="button" className="link" data-foco onClick={() => { agir(); setAnuncio(''); setEstado({ tipo: 'carregando' }); void carregar(); }}>Tentar de novo</button>
        </div>
      )}

      {estado.tipo === 'fora' && (
        <div className="rd-fora">
          <p className="nota">O Pulse ainda não acompanha este catálogo.</p>
          {!estado.confirmando ? (
            <button type="button" className="secundario" data-foco onClick={() => { agir(); setEstado({ ...estado, confirmando: true, aviso: null }); }}>Adicionar ao radar</button>
          ) : (
            <div className="rd-confirma">
              <p>{`O Pulse passa a acompanhar ofertas e preços do catálogo ${catalogProductId}. Só o código do catálogo é enviado.`}</p>
              <div className="rd-acoes">
                <button type="button" data-foco onClick={() => void adicionar()} disabled={estado.enviando}>{estado.enviando ? 'Adicionando…' : 'Adicionar'}</button>
                <button type="button" className="link" onClick={() => { agir(); setEstado({ ...estado, confirmando: false }); }} disabled={estado.enviando}>Cancelar</button>
              </div>
            </div>
          )}
          {estado.aviso && <p className="rd-aviso">{estado.aviso}</p>}
        </div>
      )}

      {estado.tipo === 'no_radar' && <NoRadarCorpo dados={estado.dados} aviso={estado.aviso} />}
    </section>
  );
}

function NoRadarCorpo({ dados: d, aviso }: { dados: NoRadar; aviso: string | null }) {
  return (
    <>
      {aviso && <p className="rd-ok">{aviso}</p>}
      {d.status === 'pausado' && <p className="nota">Pausado no Pulse: sem coletas novas até reativar no app.</p>}
      {d.ultimaColetaEm === null ? (
        <p className="nota">{d.status === 'ativo' ? 'Aguardando a primeira coleta do Pulse.' : 'Ainda sem coleta.'}</p>
      ) : (
        <div className="ct-resumo">
          <div className="ct-linha"><span className="ct-rotulo">Menor preço observado</span><span className="mono ct-forte">{d.menorPrecoObservado === null ? 'Sem ofertas ativas' : brl(d.menorPrecoObservado)}</span></div>
          <div className="ct-linha"><span className="ct-rotulo">Ofertas ativas</span><span className="mono ct-forte">{(d.ofertasAtivas ?? 0).toLocaleString('pt-BR')}</span></div>
          {d.meuPreco !== null && <div className="ct-linha"><span className="ct-rotulo">Seu preço</span><span className="mono ct-forte">{brl(d.meuPreco)}</span></div>}
          {d.referenciaML && (
            <div className="ct-linha">
              <span className="ct-rotulo">{d.referenciaML.atualizadoEm ? `Preço sugerido pelo ML em ${dia(d.referenciaML.atualizadoEm)}` : 'Preço sugerido pelo ML'}</span>
              <span className="mono ct-forte">{brl(d.referenciaML.preco)}</span>
            </div>
          )}
          <p className="nota rd-coleta">{`Última coleta ${quando(d.ultimaColetaEm)}`}</p>
        </div>
      )}
      {d.alertas.length > 0 && (
        <div className="rd-alertas">
          <h3 className="qv-sub">Alertas não lidos</h3>
          <ul>
            {d.alertas.map((a, i) => (
              <li key={`${a.criadoEm}:${i}`} className={a.acao ? 'acao' : undefined}>
                <span>{textoAlerta(a)}</span>
                <span className="rd-quando mono">{quando(a.criadoEm)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <a className="rd-abrir" data-foco href={`${URL_APP}#/pulse`} target="_blank" rel="noopener noreferrer">Abrir no Pulse</a>
    </>
  );
}
