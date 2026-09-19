-- ADR-0166: ajustes da revisao de qualidade sobre 20260919105517_adr166_tipos_produto_por_org.sql.
-- Migration antiga nunca e editada (ADR-0043); os tres ajustes vem aqui.
--
-- 1) COMENTARIO. O cabecalho da migration anterior diz que "a trava de valor fica na edge
--    `usuarios`" como se isso fechasse a escrita. Nao fecha: nao existe revoke/grant restringindo
--    UPDATE em public.organizations para `authenticated`, entao um admin da propria org escreve
--    qualquer valor direto pelo PostgREST e pula a edge inteira. Buraco REAL e PRE-EXISTENTE
--    (modulos_habilitados tem o mesmo), fora do escopo desta entrega — vira decisao separada com o
--    dono do produto. Aqui so o comentario da coluna para de prometer trava que o banco nao tem.
--
-- 2) REVOKE nao cobria `anon`. `revoke all ... from public` nao remove o grant DIRETO que o
--    Supabase da a `anon` em funcao nova — medido em producao antes deste fix:
--    has_function_privilege('anon','public.tipos_produto_da_org()','execute') = true.
--    Convencao real do repo (20260906170000/20260906170100/20260918010000): revogar dos tres roles
--    e reconceder so quem precisa.
--
-- 3) COALESCE no lugar errado. A coluna e not null, entao coalesce(tipos_produto_habilitados,'{}')
--    nunca dispara. O caso que devolve NULL e "nenhuma linha" (perfil sem org, sessao de suporte
--    expirada): sem linha, o select inteiro e NULL e a funcao retorna NULL, nao '{}'. Medido em
--    producao antes deste fix: select public.tipos_produto_da_org() is null => true.
--    Coalesce vai para fora, envolvendo a subquery.

comment on column public.organizations.tipos_produto_habilitados is
  'ADR-0166: tipos de produto habilitados (roupa/calcado), combinaveis. Vazio = comportamento padrao (so cor como eixo de variacao). A validacao dos valores existe SO na edge `usuarios` (whitelist); o banco nao tem CHECK nem revoke de UPDATE nesta coluna, entao escrita direta via PostgREST por admin da org nao e bloqueada hoje. Risco conhecido e aceito, nao garantia.';

create or replace function public.tipos_produto_da_org()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select tipos_produto_habilitados from public.organizations where id = public.current_org_id()),
    '{}'
  )
$$;

revoke all on function public.tipos_produto_da_org() from public, anon, authenticated;
grant execute on function public.tipos_produto_da_org() to authenticated;
