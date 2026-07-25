-- Semeia o cache de formato de publicação para a categoria que comprovadamente exige item
-- plano, habilitando o bloqueio de desconto visual ANTES da tentativa de publicação
-- (publish-familia-ml/processar.ts:153 — cache `user_products` + desconto = erro imediato,
-- com mensagem clara, em vez de falha crua vinda do ML).
--
-- MLB271227 (Zíperes) é a categoria do ADR-0084: exige `family_name` em item plano, e já está
-- em CATEGORIAS_QUE_EXIGEM_FAMILY_NAME (_shared/categoria/atributos.ts:89), ou seja, o CREATE
-- já vai plano nela. O seed não muda a rota — só antecipa o bloqueio do desconto.
--
-- MLB270273 (Fios e Cadarços de Armarinho) foi REMOVIDA deste seed (2026-07-25). Motivos, por
-- evidência: (a) tem 32 famílias publicadas com sucesso pelo caminho legacy `variations[]`;
-- (b) nunca foi observada com a assinatura reativa de User Products — o cache aprendido em
-- produção contém apenas MLB271701 e MLB419782; (c) não está no Set do ADR-0084. Marcá-la
-- desviaria a categoria mais usada da lista para a rota UP e passaria a rejeitar toda família
-- com desconto. O ADR-0088 §3 é explícito: seed NÃO prova formato UP — só a assinatura reativa
-- (cause_id 369+374) prova, e é o próprio publish que grava quando a observa.
insert into public.ml_formato_publicacao (connection_id, categoria_id, formato)
select mc.id, categoria.categoria_id, 'user_products'
from public.marketplace_connections mc
cross join (
  values ('MLB271227')
) as categoria(categoria_id)
where mc.canal = 'mercado_livre'
on conflict (connection_id, categoria_id) do update
set formato = excluded.formato;
