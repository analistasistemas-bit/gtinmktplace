// Rodapé da conta (ADR-0189): quem está logado, chave "Extensão ativa", abrir o app e sair.
import { URL_APP, type EstadoExt, type RespostaEstado } from './formato';

export function Conta({ estado, onEstado, onRefazer }: {
  estado: EstadoExt;
  onEstado: (e: EstadoExt) => void;
  /** Resposta sem estado utilizável (geração velha etc.): reler `publiai:estado-extensao`. */
  onRefazer: () => void;
}) {
  const enviar = async (msg: object) => {
    let r: RespostaEstado | undefined;
    try {
      r = (await chrome.runtime.sendMessage({ ...msg, geracao: estado.geracao })) as RespostaEstado | undefined;
    } catch {
      r = undefined;
    }
    if (r?.ok && typeof r.geracao === 'number' && typeof r.logado === 'boolean') onEstado(r as EstadoExt);
    else onRefazer();
  };

  return (
    <footer className="cartao conta">
      <div className="conta-quem">
        <span className="conta-nome">{estado.perfil?.nome ?? 'Conta PubliAI'}</span>
        {estado.perfil?.orgNome && <span className="nota">{estado.perfil.orgNome}</span>}
      </div>
      <div className="conta-chave">
        <span id="chave-ativa">Extensão ativa</span>
        <button
          type="button"
          role="switch"
          aria-checked={estado.ativa}
          aria-labelledby="chave-ativa"
          className="chave"
          onClick={() => void enviar({ tipo: 'publiai:definir-ativa', ativa: !estado.ativa })}
        />
      </div>
      <div className="conta-acoes">
        <a className="botao secundario" href={URL_APP} target="_blank" rel="noopener noreferrer">Abrir o PubliAI</a>
        <button type="button" className="secundario perigo" onClick={() => void enviar({ tipo: 'publiai:sair' })}>Sair</button>
      </div>
    </footer>
  );
}
