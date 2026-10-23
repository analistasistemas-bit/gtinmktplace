// Painel lateral da Extensão PubliAI (ADR-0189 D-6/D-16). Mostra a última análise que o content
// script fez na aba ativa (guardada no SW) e simula preço/custo a partir dela.
import { useEffect, useState } from 'react';
import { MinhaMargem } from './MinhaMargem';
import { Busca } from './Busca';
import { Catalogo } from './Catalogo';
import type { EstadoBusca } from '../busca-sw';
import { Qualidade } from './Qualidade';
import { Radar } from './Radar';
import { QuantoVende } from './QuantoVende';
import { Vendedor } from './Vendedor';
import { VinculoProduto } from './VinculoProduto';
import { mensagemDeErro, URL_APP, type Chamar, type EstadoAba, type Resposta, type RespostaAnuncio } from './formato';

const chamarViaSw: Chamar = async (corpo) => {
  try {
    return (await chrome.runtime.sendMessage({ tipo: 'publiai:chamar', corpo })) ?? { ok: false, erro: 'interno' };
  } catch {
    return { ok: false, erro: 'interno' };
  }
};

type Reanalisar = () => Promise<Resposta<RespostaAnuncio> | null>;

export function App() {
  // undefined = carregando; null = aba sem análise.
  const [estado, setEstado] = useState<EstadoAba | null | undefined>(undefined);
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    let abaAtual: number | null = null;
    const carregar = async (tabId: number) => {
      const e = (await chrome.runtime.sendMessage({ tipo: 'publiai:estado-da-aba', tabId }).catch(() => null)) as EstadoAba | null;
      if (tabId !== abaAtual) return; // trocou de aba no meio
      setEstado(e ?? null);
    };
    // Sem a permissão `tabs`: o id da aba ativa vem mesmo assim.
    const lerAbaAtiva = async () => {
      const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
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
        analisar={(forcar) => chrome.runtime.sendMessage({ tipo: 'publiai:analisar-busca', tabId, forcar }).catch(() => ({ ok: false, erro: 'interno' }))}
        destacar={(itemId) => { chrome.runtime.sendMessage({ tipo: 'publiai:destacar-card', tabId, itemId }).catch(() => {}); }}
      />
    );
  }
  // O SW refaz a análise da aba e guarda o resultado: trocar de aba e voltar não traz o estado velho.
  const reanalisarAba: Reanalisar = () =>
    chrome.runtime.sendMessage({ tipo: 'publiai:reanalisar-aba', tabId }).catch(() => ({ ok: false, erro: 'interno' }));
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
