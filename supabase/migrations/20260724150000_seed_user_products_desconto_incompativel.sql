-- Categorias comprovadas em User Products; este seed habilita o bloqueio antes da próxima tentativa.
insert into public.ml_formato_publicacao (connection_id, categoria_id, formato)
select mc.id, categoria.categoria_id, 'user_products'
from public.marketplace_connections mc
cross join (
  values ('MLB270273'), ('MLB271227')
) as categoria(categoria_id)
where mc.canal = 'mercado_livre'
on conflict (connection_id, categoria_id) do update
set formato = excluded.formato;
