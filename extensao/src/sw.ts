// Service worker da Extensão PubliAI (ADR-0189 D-4/D-14). Único contexto que toca
// chrome.storage.session; content scripts e painel falam com ele por mensagem.
import { esquecerAba, esquecerEstado } from './abas';
import { rotearMensagem } from './roteador';
import { receberMensagemExterna } from './sessao';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Sessão empurrada pelo PubliAI web; a origem é conferida dentro de receberMensagemExterna.
chrome.runtime.onMessageExternal.addListener((msg, sender, responder) => {
  receberMensagemExterna(msg, sender).then(responder, () => responder({ ok: false }));
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  const r = rotearMensagem(msg, sender);
  if (!r) return false;
  r.then(responder, () => responder({ ok: false, erro: 'interno' }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => { esquecerAba(tabId); esquecerEstado(tabId); });
