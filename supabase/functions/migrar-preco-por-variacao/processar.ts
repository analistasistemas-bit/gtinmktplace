// ADR-0161 — disparo da migração "preço por variação" (UPtin), pedido pelo operador.
//
// Lógica separada do `index.ts` para ser testável sem HTTP. Tudo aqui roda ANTES de uma escrita
// IRREVERSÍVEL no Mercado Livre: a migração encerra o anúncio original e não pode ser desfeita.
// Por isso a ordem importa e cada recusa é explícita.

import type { VariacaoSnapshot } from '../_shared/ml/migracao-pxv.ts';

export type ResultadoDisparo =
  | { tipo: 'ok'; codigoPai: string }
  // Recusa ANTES de qualquer chamada ao ML. `motivo` vai direto ao operador.
  | { tipo: 'recusado'; motivo: string }
  // O POST no ML falhou. O estado fica `solicitada` de propósito: a idempotência do endpoint não é
  // documentada, então "falhou" não prova "não aconteceu".
  | { tipo: 'falha_ml'; motivo: string };

export interface PortasDisparo {
  /** Família + raiz da partição 0, já no escopo da org do chamador. */
  carregarContexto(familiaId: string): Promise<{
    familia: { id: string; orgId: string; codigoPai: string; mlItemId: string | null; status: string | null } | null;
    /** Todas as linhas de `anuncios_externos` do pai — mais de uma = produto dividido. */
    particoes: Array<{ particao: number; itemExternoId: string | null; migracaoStatus: string | null }>;
    /** `ml_item_id` da família MAIS NOVA do pai (a que `ingest-lote` usaria). */
    mlItemIdMaisNovo: string | null;
    /** Alguma família do pai em publicação — não se migra no meio de um envio. */
    algumaPublicando: boolean;
    /** O item é componente de algum kit virtual. */
    emKitVirtual: boolean;
  }>;
  /** Elegibilidade no ML. */
  validarElegibilidade(mlItemId: string): Promise<{ elegivel: boolean; causas: string[] }>;
  /** `variations[]` ao vivo, para o snapshot. */
  lerVariacoes(mlItemId: string): Promise<VariacaoSnapshot[]>;
  /**
   * Claim ATÔMICO: grava `solicitada` + snapshot + `ml_item_id_anterior` na raiz, e devolve `false`
   * se outra migração já estava em curso. Check-then-set não serve — dois admins (ou um clique
   * duplo) leem `null` ao mesmo tempo e ambos disparam.
   */
  reservar(entrada: {
    codigoPai: string; snapshot: VariacaoSnapshot[]; mlItemIdAnterior: string;
  }): Promise<boolean>;
  /** POST no ML. Nunca chamado mais de uma vez por disparo. */
  dispararNoML(mlItemId: string): Promise<void>;
  /** Registra a falha do POST na raiz, preservando `solicitada`. */
  registrarFalha(codigoPai: string, motivo: string): Promise<void>;
  /** Enfileira a primeira rodada de acompanhamento. */
  enfileirarAcompanhamento(codigoPai: string): Promise<void>;
}

export async function dispararMigracaoPxv(
  portas: PortasDisparo,
  familiaId: string,
): Promise<ResultadoDisparo> {
  const ctx = await portas.carregarContexto(familiaId);
  const familia = ctx.familia;

  // Ownership. O molde desta função (`atualizar-status-publicado`) NÃO checa isso — recebe um
  // `ml_item_id` e escreve nele. Aqui a família precisa existir DENTRO da org do chamador; o
  // carregador já filtra por org, então "não achou" cobre tanto id inexistente quanto id de outra
  // organização, sem revelar qual dos dois.
  if (!familia) {
    return { tipo: 'recusado', motivo: 'Produto não encontrado nesta organização.' };
  }
  if (!familia.mlItemId) {
    return { tipo: 'recusado', motivo: 'Este produto não está publicado no Mercado Livre.' };
  }

  // Produto dividido em N anúncios (ADR-0048/0078). A RPC de adoção zera `ml_variation_id` de TODA
  // a família — inclusive das cores que vivem na partição que continua ativa —, e o próximo UPDATE
  // as trataria como novas, DUPLICANDO variações num anúncio real. Sem contorno barato: recusa.
  if (ctx.particoes.length > 1) {
    return {
      tipo: 'recusado',
      motivo: 'Este produto está publicado como vários anúncios (um por faixa de preço) e não pode '
        + 'ser migrado pelo app. Migrar aqui desligaria o vínculo das cores que vivem nos outros '
        + 'anúncios.',
    };
  }

  const raiz = ctx.particoes.find((p) => p.particao === 0);
  // `espelharAnuncioExterno` é best-effort: família antiga pode não ter raiz. Sem ela não há onde
  // guardar o estado da migração — e criar a raiz aqui inventaria um vínculo que ninguém confirmou.
  if (!raiz) {
    return {
      tipo: 'recusado',
      motivo: 'Este produto não tem registro de anúncio no app (publicação antiga). Publique uma '
        + 'atualização antes de migrar.',
    };
  }
  if (raiz.migracaoStatus === 'solicitada' || raiz.migracaoStatus === 'em_andamento') {
    return { tipo: 'recusado', motivo: 'Já existe uma migração em andamento para este produto.' };
  }
  // `erro`: a migração anterior parou. NÃO é "em andamento" — recusar com aquela mensagem mandaria
  // o operador esperar por algo que não vai acontecer. Também não se redispara automaticamente: se
  // o ML já migrou (o original estará encerrado), um segundo POST é comportamento indocumentado.
  // A saída é o UPDATE, que adota pelo caminho do ADR-0105.
  if (raiz.migracaoStatus === 'erro') {
    return {
      tipo: 'recusado',
      motivo: 'A migração anterior deste produto terminou em erro. Publique uma atualização para o '
        + 'app reconciliar com o Mercado Livre antes de tentar de novo.',
    };
  }

  // Estado local incoerente: a raiz aponta para um anúncio diferente do da família (ou do que o
  // ingest usaria). Migrar em cima disso adotaria no lugar errado.
  const divergeDaFamilia = raiz.itemExternoId != null && raiz.itemExternoId !== familia.mlItemId;
  const divergeDoMaisNovo = ctx.mlItemIdMaisNovo != null && ctx.mlItemIdMaisNovo !== familia.mlItemId;
  if (divergeDaFamilia || divergeDoMaisNovo) {
    return {
      tipo: 'recusado',
      motivo: 'O registro do anúncio no app está inconsistente (aponta para mais de um anúncio). '
        + 'Publique uma atualização para reconciliar antes de migrar.',
    };
  }

  if (ctx.algumaPublicando) {
    return {
      tipo: 'recusado',
      motivo: 'Este produto está sendo publicado agora. Aguarde a publicação terminar e tente de novo.',
    };
  }

  // Kit virtual referencia o componente por `user_product_id`, e a migração cria ids novos. O que o
  // ML faz com o bundle nesse momento não está documentado — bloquear é mais barato que descobrir
  // com um kit real quebrado.
  if (ctx.emKitVirtual) {
    return {
      tipo: 'recusado',
      motivo: 'Este produto faz parte de um Kit Virtual. Encerre o kit antes de migrar.',
    };
  }

  const eleg = await portas.validarElegibilidade(familia.mlItemId);
  if (!eleg.elegivel) {
    return {
      tipo: 'recusado',
      motivo: `O Mercado Livre não permite migrar este anúncio: ${eleg.causas.join('; ')}`,
    };
  }

  // Snapshot ANTES do POST. Depois que o ML encerra o item original, `variations[]` pode não estar
  // mais lá — e a descoberta por título (ADR-0105) pode casar com uma família IRMÃ de mesmo título e
  // mesmas cores, adotando os itens do produto errado. Com o snapshot, o casamento usa só ids que o
  // ML atribuiu a ESTE item.
  const snapshot = await portas.lerVariacoes(familia.mlItemId);
  if (snapshot.length === 0) {
    return {
      tipo: 'recusado',
      motivo: 'Não foi possível ler as variações deste anúncio no Mercado Livre. Nada foi alterado.',
    };
  }
  // A cor é a única chave do casamento por atributo. Duplicada, ela deixa de identificar a variação
  // — e adotar com chave ambígua é pior que não adotar (ADR-0105).
  const cores = snapshot.map((v) => v.cor).filter((c): c is string => c != null && c !== '');
  if (new Set(cores).size !== cores.length) {
    return {
      tipo: 'recusado',
      motivo: 'Este anúncio tem duas variações com a mesma cor no Mercado Livre. Corrija a cor '
        + 'antes de migrar, senão o app não consegue casar as cores com os anúncios novos.',
    };
  }

  // Reserva atômica: quem perder a corrida não dispara.
  const reservou = await portas.reservar({
    codigoPai: familia.codigoPai, snapshot, mlItemIdAnterior: familia.mlItemId,
  });
  if (!reservou) {
    return { tipo: 'recusado', motivo: 'Já existe uma migração em andamento para este produto.' };
  }

  try {
    await portas.dispararNoML(familia.mlItemId);
  } catch (e) {
    // NÃO limpa o estado. A doc do ML não documenta a idempotência do POST, então uma falha aqui
    // não prova que a migração não começou. Deixar `solicitada` faz o worker consultar o status e
    // descobrir a verdade, em vez de o operador clicar de novo e disparar uma segunda migração.
    const motivo = (e as Error).message;
    await portas.registrarFalha(familia.codigoPai, motivo);
    // Ainda assim acompanha: se o ML tiver iniciado, o worker adota; se não, ele encerra em erro.
    await portas.enfileirarAcompanhamento(familia.codigoPai);
    return { tipo: 'falha_ml', motivo };
  }

  await portas.enfileirarAcompanhamento(familia.codigoPai);
  return { tipo: 'ok', codigoPai: familia.codigoPai };
}
