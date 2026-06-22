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

/** Compara os moderados de agora com os registros abertos (resolvido_em null). */
export function diffModerados(
  correntes: ModeradoCorrente[],
  abertos: RegistroAberto[],
): DiffModeracao {
  const abertosSet = new Set(abertos.map((a) => a.ml_item_id));
  const correntesSet = new Set(correntes.map((c) => c.ml_item_id));
  const novos = correntes.filter((c) => !abertosSet.has(c.ml_item_id));
  const resolvidos = abertos
    .map((a) => a.ml_item_id)
    .filter((id) => !correntesSet.has(id));
  return { novos, resolvidos };
}
