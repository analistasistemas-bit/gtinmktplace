export interface ModeradoCorrente {
  ml_item_id: string;
  status: string;
  motivo: string | null;
}
export interface RegistroAberto {
  ml_item_id: string;
}
export interface DiffModeracao {
  novos: ModeradoCorrente[];
  resolvidos: string[];
}

/** Compara os moderados de agora com os registros abertos (resolvido_em null).
 *
 * `resolvidosConfirmados` = ids cujo status FOI LIDO com sucesso e é definido ≠ moderado. Só esses
 * marcam um aberto como resolvido. AUSÊNCIA de um id (bloco de status que falhou no ML → volta como
 * 'indisponivel') NÃO resolve: senão uma falha parcial de leitura silenciaria um alerta de
 * moderação ainda ativo (achado da revisão do lote 4). */
export function diffModerados(
  correntes: ModeradoCorrente[],
  abertos: RegistroAberto[],
  resolvidosConfirmados: Set<string>,
): DiffModeracao {
  const abertosSet = new Set(abertos.map((a) => a.ml_item_id));
  const novos = correntes.filter((c) => !abertosSet.has(c.ml_item_id));
  const resolvidos = abertos
    .map((a) => a.ml_item_id)
    .filter((id) => resolvidosConfirmados.has(id));
  return { novos, resolvidos };
}

/** Monta o conjunto de ids que PODEM resolver um aberto. Um aberto resolve quando:
 *  (a) seu status foi LIDO com sucesso e é definido ≠ 'moderado' e ≠ 'indisponivel'; OU
 *  (b) sua família não existe mais na lista local (`ids`) — item removido (remover-publicado
 *      apaga a família sem fechar ml_moderacao), então a moderação órfã deve fechar.
 *  Chamar SÓ quando a leitura de `familias` teve sucesso (senão um id ausente seria falha de
 *  leitura, não item removido). Bloco de status que falhou vira 'indisponivel' → não entra em (a),
 *  e o item continua em `ids` → não é órfão em (b): fica aberto (não silencia alerta ativo). */
export function resolvidosConfirmadosDe(
  ids: string[],
  statusPorId: Record<string, { status?: string } | undefined>,
  abertos: RegistroAberto[],
): Set<string> {
  const idsFamilia = new Set(ids);
  const set = new Set<string>();
  for (const id of ids) {
    const s = statusPorId[id]?.status;
    if (s != null && s !== 'moderado' && s !== 'indisponivel') set.add(id);
  }
  for (const a of abertos) {
    if (!idsFamilia.has(a.ml_item_id)) set.add(a.ml_item_id); // órfão: família não existe mais
  }
  return set;
}
