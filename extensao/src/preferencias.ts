// Chave "Extensão ativa" (ADR-0189, emenda 2026-10-24): preferência do Chrome inteiro em storage.local (padrão: ativa).
// storage.local é TRUSTED_CONTEXTS: content scripts não leem — sabem por mensagem do SW (publiai:estado-extensao,
// publiai:ativacao, publiai:conta-mudou). Só o SW importa este módulo.
import { epocaAtual, novaEpoca, transmitir } from './abas';
import { estaLogado } from './credenciais';
import { limparAbasNaFila } from './sessao';

const CHAVE = 'ativa'; // = lida direto em abas.ts (transmitirConta)

export async function estaAtiva(): Promise<boolean> {
  return (await chrome.storage.local.get(CHAVE))[CHAVE] !== false;
}

/** Desligar abre época nova antes do 1º await (pedidos em voo são descartados) e limpa as abas; ligar só grava.
 *  As duas avisam painel e abas do ML com a geração nova. */
export async function definirAtiva(ativa: boolean): Promise<void> {
  if (!ativa) novaEpoca();
  await chrome.storage.local.set({ [CHAVE]: ativa });
  if (!ativa) await limparAbasNaFila();
  await transmitir({ tipo: 'publiai:ativacao', ativa, logado: await estaLogado(), geracao: epocaAtual() });
}
