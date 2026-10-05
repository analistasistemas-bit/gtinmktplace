-- Menu novo (ADR-0047, como a Vitrine; ADR-0179): quem já vê Faturamento passa a ver Ads (o módulo 'ads' por org
-- ainda decide se aparece). Aplicada só depois do deploy da edge `usuarios` que conhece 'ads' (v45) e do front,
-- senão uma edição de permissão pela edge antiga apagaria a chave.
update public.profiles set allowed_menus = array_append(allowed_menus, 'ads')
  where 'faturamento' = any(allowed_menus) and not ('ads' = any(allowed_menus));
