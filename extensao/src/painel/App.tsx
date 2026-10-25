// Painel lateral da Extensão PubliAI (ADR-0189 D-6/D-16). Mostra a última análise que o content
// script fez na aba ativa (guardada no SW) e simula preço/custo a partir dela.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MinhaMargem } from './MinhaMargem';
import { Busca } from './Busca';
import { Catalogo } from './Catalogo';
import type { EstadoBusca } from '../busca-sw';
import { Qualidade } from './Qualidade';
import { Radar } from './Radar';
import { QuantoVende } from './QuantoVende';
import { Vendedor } from './Vendedor';
import { VinculoProduto } from './VinculoProduto';
import { Conta } from './Conta';
import { Entrar } from './Entrar';
import { mensagemDeErro, URL_APP, type Chamar, type EstadoAba, type EstadoExt, type Resposta, type RespostaAnuncio } from './formato';

type Reanalisar = () => Promise<Resposta<RespostaAnuncio> | null>;
/** Geração que o painel mostra agora (null = invalidada, releitura em curso). */
type Vigente = () => number | null;

// Todo comando do painel leva a geração do SW (R9). Resposta de outra geração = estado velho: descartar e reler.
// Painel já em outra geração (aviso chegou com o pedido em voo): a resposta não chega a nenhum componente.
async function comando(geracao: number, msg: object, aoDescartar: () => void, vigente: Vigente): Promise<{ ok?: boolean; erro?: string; geracao?: unknown }> {
  let r: { ok?: boolean; erro?: string; geracao?: unknown } | null | undefined;
  try {
    r = (await chrome.runtime.sendMessage({ ...msg, geracao })) as typeof r;
  } catch {
    return { ok: false, erro: 'interno' };
  }
  if (vigente() !== geracao) return { ok: false, erro: 'geracao_antiga' };
  if (r?.erro === 'geracao_antiga' || (typeof r?.geracao === 'number' && r.geracao !== geracao)) aoDescartar();
  return r ?? { ok: false, erro: 'interno' };
}

/** Lê o estado da extensão e o mantém atualizado pelos avisos do SW. `undefined` = carregando, `null` = SW não respondeu. */
function useEstadoExt() {
  const [ext, setExt] = useState<EstadoExt | null | undefined>(undefined);
  const seq = useRef(0);
  const vigente = useRef<number | null>(null);
  const mostrar = useCallback((e: EstadoExt | null | undefined) => { vigente.current = e?.geracao ?? null; setExt(e); }, []);
  const suspenso = useRef(false); // login em voo: os avisos do SW (logado antes de validar) não valem
  const reler = useCallback(async (abrindo = false) => {
    const minha = ++seq.current;
    let e: EstadoExt | undefined;
    try {
      e = (await chrome.runtime.sendMessage({ tipo: 'publiai:estado-extensao', abrindo })) as EstadoExt | undefined;
    } catch {
      e = undefined;
    }
    if (minha !== seq.current) return; // chegou uma leitura mais nova
    mostrar(e && typeof e.geracao === 'number' ? e : null);
  }, [mostrar]);
  const aplicar = useCallback((e: EstadoExt) => { seq.current++; mostrar(e); }, [mostrar]);
  const suspender = useCallback((sim: boolean) => { suspenso.current = sim; seq.current++; }, []);
  useEffect(() => {
    const aoAviso = (m: unknown) => {
      const { tipo: t, geracao } = (m as { tipo?: unknown; geracao?: unknown } | null) ?? {};
      if (suspenso.current || (t !== 'publiai:conta-mudou' && t !== 'publiai:ativacao')) return;
      // Geração nova: o conteúdo da anterior sai já (carregando), sem esperar a releitura.
      if (typeof geracao === 'number' && geracao !== vigente.current) mostrar(undefined);
      void reler();
    };
    chrome.runtime.onMessage.addListener(aoAviso);
    void reler(true);
    return () => chrome.runtime.onMessage.removeListener(aoAviso);
  }, [reler, mostrar]);
  const geracaoVigente = useCallback(() => vigente.current, []);
  return { ext, reler, aplicar, suspender, geracaoVigente };
}

export function App() {
  const { ext, reler, aplicar, suspender, geracaoVigente } = useEstadoExt();
  if (ext === undefined) {
    return <div className="esqueleto" role="status" aria-label="Carregando"><span /><span /><span /></div>;
  }
  if (ext === null) {
    return (
      <div className="cartao chamada" role="alert">
        <h2>Sem resposta da extensão</h2>
        <p>Feche e abra o painel, ou tente de novo.</p>
        <button type="button" className="secundario" onClick={() => void reler(true)}>Tentar de novo</button>
      </div>
    );
  }
  if (!ext.logado) return <Entrar onEstado={aplicar} onEmVoo={suspender} />;
  const conta = <Conta estado={ext} onEstado={aplicar} onRefazer={() => void reler()} />;
  if (!ext.ativa) {
    const ativar = async () => {
      const r = await comando(ext.geracao, { tipo: 'publiai:definir-ativa', ativa: true }, () => void reler(), geracaoVigente);
      if (r.ok && typeof (r as Partial<EstadoExt>).logado === 'boolean') aplicar(r as unknown as EstadoExt);
      else void reler();
    };
    return (
      <>
        <div className="cartao chamada">
          <h2>Extensão desativada</h2>
          <p>Selos e análises pausados</p>
          <button type="button" onClick={ativar}>Ativar</button>
        </div>
        {conta}
      </>
    );
  }
  // A geração na chave remonta tudo (simulações, chamadas em voo) quando o SW troca de conta ou pausa.
  return (
    <>
      <Logado key={ext.geracao} geracao={ext.geracao} aoDescartar={() => void reler()} vigente={geracaoVigente} />
      {conta}
    </>
  );
}

function Logado({ geracao, aoDescartar, vigente }: { geracao: number; aoDescartar: () => void; vigente: Vigente }) {
  const chamarViaSw: Chamar = (corpo) => comando(geracao, { tipo: 'publiai:chamar', corpo }, aoDescartar, vigente) as never;
  // undefined = carregando; null = aba sem análise.
  const [estado, setEstado] = useState<EstadoAba | null | undefined>(undefined);
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    let abaAtual: number | null = null;
    let cancelado = false;
    const carregar = async (tabId: number) => {
      const e = (await chrome.runtime.sendMessage({ tipo: 'publiai:estado-da-aba', tabId }).catch(() => null)) as EstadoAba | null;
      if (tabId !== abaAtual || vigente() !== geracao) return; // trocou de aba (ou de geração) no meio
      setEstado(e ?? null);
    };
    // Sem a permissão `tabs`: o id da aba ativa vem mesmo assim.
    const lerAbaAtiva = async () => {
      const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (cancelado) return;
      abaAtual = aba?.id ?? null;
      setEstado(undefined); // até o estado desta aba chegar, nada da anterior (com o tabId novo) aparece
      setTabId(abaAtual);
      if (abaAtual === null) setEstado(null);
      else await carregar(abaAtual);
    };
    const aoMensagem = (m: unknown) => {
      const msg = m as { tipo?: unknown; tabId?: unknown } | null;
      if (msg?.tipo === 'publiai:estado-atualizado' && msg.tabId === abaAtual && abaAtual !== null) void carregar(abaAtual);
    };
    const aoAtivar = () => { void lerAbaAtiva(); };
    chrome.runtime.onMessage.addListener(aoMensagem);
    chrome.tabs.onActivated.addListener(aoAtivar);
    void lerAbaAtiva();
    return () => {
      cancelado = true;
      abaAtual = null;
      chrome.runtime.onMessage.removeListener(aoMensagem);
      chrome.tabs.onActivated.removeListener(aoAtivar);
    };
  }, []);

  if (estado === undefined) {
    return (
      <div className="esqueleto" role="status" aria-label="Carregando a análise">
        <span /><span /><span />
      </div>
    );
  }
  // Aba numa busca do ML: resumo, filtros e lista no painel (Task 22).
  if (estado && (estado.entrada as { tipoPagina?: string }).tipoPagina === 'busca') {
    return (
      <Busca
        key={`${tabId}:${(estado.entrada as { url?: string }).url ?? ''}`}
        estado={estado as unknown as EstadoBusca}
        chamar={chamarViaSw}
        analisar={(forcar) => comando(geracao, { tipo: 'publiai:analisar-busca', tabId, forcar }, aoDescartar, vigente) as never}
        destacar={(itemId) => { chrome.runtime.sendMessage({ tipo: 'publiai:destacar-card', tabId, itemId }).catch(() => {}); }}
      />
    );
  }
  // O SW refaz a análise da aba e guarda o resultado: trocar de aba e voltar não traz o estado velho.
  const reanalisarAba: Reanalisar = () => comando(geracao, { tipo: 'publiai:reanalisar-aba', tabId }, aoDescartar, vigente) as never;
  // Remonta (zera preço/custo digitados) só quando muda o anúncio; mesmo anúncio mantém a simulação.
  // Tipo de página entra na chave: em /p/ o item é o da buy box, o mesmo id do anúncio dele (o simulador recomeça).
  return <Painel key={estado ? `${estado.entrada.mlItemId}:${(estado.entrada as { tipoPagina?: string }).tipoPagina ?? ''}` : 'vazio'} estado={estado} chamar={chamarViaSw} reanalisarAba={reanalisarAba} />;
}

export function Painel({ estado, chamar, reanalisarAba }: { estado: EstadoAba | null; chamar: Chamar; reanalisarAba: Reanalisar }) {
  // Preço confirmado no servidor vale só enquanto o estado da aba for o mesmo de quando foi pedido.
  const [confirmado, setConfirmado] = useState<{ base: EstadoAba['resposta']; dados: RespostaAnuncio } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // "Simular minha margem a R$ X" do bloco Catálogo: seq muda a cada clique (mesmo preço de novo também simula).
  const [simular, setSimular] = useState<{ valor: number; seq: number } | null>(null);

  if (!estado) {
    return (
      <div className="cartao chamada">
        <h2>Nenhum anúncio nesta aba</h2>
        <p>Abra um anúncio do Mercado Livre para ver sua margem. Ela também aparece ao lado do preço, na própria página.</p>
      </div>
    );
  }
  const { entrada } = estado;
  const resposta: Resposta<RespostaAnuncio> =
    confirmado?.base === estado.resposta ? { ok: true, dados: confirmado.dados } : estado.resposta;

  const analisar = (preco: number) =>
    chamar<RespostaAnuncio>({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', ...entrada, preco });
  // O SW grava e avisa (estado-atualizado); o App recarrega o estado.
  const reanalisar = async () => {
    setOcupado(true);
    await reanalisarAba();
    setOcupado(false);
  };

  const anuncio = (tipo: string) => (
    <div className="anuncio">
      <span className="rotulo">{tipo}</span>
      <span className="mono nota">{`Anúncio ${entrada.mlItemId}`}</span>
    </div>
  );
  if (!resposta.ok) {
    const semConexao = resposta.erro === 'sem_sessao' || resposta.erro === 'sessao_expirada';
    return (
      <>
        {anuncio('Mercado Livre')}
        <div className="cartao chamada" role="alert">
          <h2>{semConexao ? 'Extensão desconectada' : 'Não deu para calcular'}</h2>
          <p>{mensagemDeErro(resposta.erro)}</p>
          {semConexao ? (
            <a className="botao" href={URL_APP} target="_blank" rel="noopener noreferrer">Abrir o PubliAI</a>
          ) : (
            <button type="button" className="secundario" disabled={ocupado} onClick={reanalisar}>Tentar de novo</button>
          )}
        </div>
      </>
    );
  }
  if (resposta.dados.proprio) {
    return (
      <>
        {anuncio('Seu anúncio')}
        <div className="cartao chamada">
          <h2>Este anúncio é da sua empresa</h2>
          <p>Vendas, margem e estoque dele ficam no PubliAI.</p>
          <a className="botao" href={URL_APP} target="_blank" rel="noopener noreferrer">Abrir no PubliAI</a>
        </div>
      </>
    );
  }
  return (
    <>
      {anuncio('Concorrente')}
      {estado.observado && (
        <QuantoVende
          observado={estado.observado}
          catalogo={(entrada as { tipoPagina?: string }).tipoPagina === 'catalogo'}
          catalogoCriadoEm={resposta.dados.catalogoCriadoEm}
        />
      )}
      <MinhaMargem
        entrada={entrada}
        dados={resposta.dados}
        analisar={analisar}
        onDados={(dados) => setConfirmado({ base: estado.resposta, dados })}
        precoSugerido={simular}
        precoPix={estado.observado?.precoPix}
        tipoAnuncio={estado.observado?.tipoAnuncio}
      />
      {(resposta.dados.custo.fonte === 'nenhuma' || resposta.dados.custo.fonte === 'vinculo_manual') && (
        <VinculoProduto entrada={entrada} fonte={resposta.dados.custo.fonte} chamar={chamar} onVinculado={reanalisar} />
      )}
      {/* Contexto, depois da tarefa principal (margem + vínculo, D-6). */}
      {entrada.catalogProductId && (
        <Catalogo
          key={`${entrada.catalogProductId}:${(entrada as { tipoPagina?: string }).tipoPagina}:${entrada.mlItemId}`}
          entrada={{ tipoPagina: (entrada as { tipoPagina?: string }).tipoPagina, mlItemId: entrada.mlItemId, catalogProductId: entrada.catalogProductId }}
          chamar={chamar}
          onSimular={(valor) => setSimular((s) => ({ valor, seq: (s?.seq ?? 0) + 1 }))}
        />
      )}
      {entrada.catalogProductId && <Radar key={entrada.catalogProductId} catalogProductId={entrada.catalogProductId} chamar={chamar} />}
      {estado.observado?.qualidade && <Qualidade dados={estado.observado.qualidade} mlItemId={estado.entrada.mlItemId} />}
      {resposta.dados.vendedor && <Vendedor vendedor={resposta.dados.vendedor} lojaOficial={estado.observado?.lojaOficial} />}
    </>
  );
}
