import type { Familia } from './tipos-dominio';

export interface ResultadoPublicavel {
  ok: boolean;
  motivos: string[];
}

export function familiaPublicavel(familia: Familia): ResultadoPublicavel {
  const motivos: string[] = [];

  // 'erro' é re-publicável (retry após falha de publicação); só bloqueia status de processamento.
  if (familia.status !== 'pronto' && familia.status !== 'erro') {
    motivos.push('Ainda em processamento (aguarde ficar "pronta")');
  }
  if (familia.operacao !== 'CREATE') motivos.push('Já publicada (CREATE só vale para famílias novas)');
  if (!familia.categoriaMlId) motivos.push('Categoria indefinida');

  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  if (incluidas.length === 0) {
    motivos.push('Nenhuma cor incluída (ao menos 1 obrigatória)');
  }
  for (const v of incluidas) {
    if (!v.cor) motivos.push(`Cor ${v.codigo} sem cor definida`);
    if (!v.fotoPath) motivos.push(`Cor ${v.cor || v.codigo} sem foto`);
    if (!v.precoPublicacao || v.precoPublicacao <= 0) motivos.push(`Cor ${v.cor || v.codigo} sem preço de publicação`);
  }

  return { ok: motivos.length === 0, motivos };
}
