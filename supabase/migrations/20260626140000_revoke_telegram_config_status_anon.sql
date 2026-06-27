-- Segurança: telegram_config_status() é SECURITY DEFINER e estava executável pelo papel `anon`
-- (advisor 0028). A função filtra por auth.uid(), então anon já recebia vazio, mas anon nunca
-- a chama legitimamente (o app chama autenticado). Revoga EXECUTE de anon para fechar a exposição.
revoke execute on function public.telegram_config_status() from anon;
