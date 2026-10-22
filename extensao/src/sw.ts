// Service worker da Extensão PubliAI (ADR-0189 D-4/D-14). Único contexto que toca
// chrome.storage.session; content scripts e painel falam com ele por mensagem.
import { esquecerAba, esquecerEstado } from './abas';
import { aoAtualizarAba, rotearMensagem } from './roteador';
import { aoAlarme, obterSessaoValida, receberMensagemExterna } from './sessao';

// Expiração passiva da sessão (ADR-0189 D-4): listener no topo sobrevive à suspensão do MV3; no boot,
// confere a sessão (alarme perdido com o navegador fechado/SW suspenso).
chrome.alarms.onAlarm.addListener((a) => { void aoAlarme(a); });
void obterSessaoValida();

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

chrome.tabs.onUpdated.addListener((tabId, info) => { void aoAtualizarAba(tabId, info); });
chrome.tabs.onRemoved.addListener((tabId) => { esquecerAba(tabId); esquecerEstado(tabId); });
