# ADR-0172 — Operações em massa, começando por aderir/sair de promoção (I5 + Promoções V2)

**Status:** Proposto (vira Aceito depois do spike de escrita — ver "Pré-requisito")
**Data:** 2026-09-26
**Relacionado:** [ADR-0170](0170-central-de-promocoes-ml.md) (Central de Promoções, só leitura),
[ADR-0060](0060-pausar-reativar-anuncio-ml.md) (pausar/reativar restrito a admin),
[ADR-0006](0006-qstash-em-vez-de-postgres-queue.md) (QStash),
[ADR-0020](0020-estrategia-de-preco-liquido-minimo.md) / [ADR-0055](0055-imposto-por-origem-nacional-importado.md) (piso, líquido, imposto)
**Origem:** grilling 2026-09-26 sobre os itens 1 e 2 do próximo ciclo em `docs/Roadmap/ROADMAP-MELHORIAS-PUBLIAI.md`

## Contexto

O roadmap tinha duas entregas separadas: **I5 Operações em massa** (motor seleção → preview → execução →
resultado por item → reversão) e **Promoções V2** (aderir/sair de campanha pelo app, com confirmação humana,
começando por DEAL/SMART). A V2 feita anúncio a anúncio seria reescrita quando o I5 chegasse, e a 10.10 da Avil
tem 504 convidados — ninguém adere a 504 anúncios um por um. O discovery com a Avil sobre quais operações
coletivas se repetem (preço, pausa, estoque) ainda não aconteceu.

A escrita em `/seller-promotions` **nunca foi testada** (spike I1 foi só GET) e as conexões mostram o scope
`offers:/read-only`. As permissões vêm da aplicação no DevCenter do ML, não do `authUrl`, e o token guarda o
scope do momento da autorização.

## Decisão

1. **Motor único, promoção primeiro.** O I5 nasce com uma só família de operação: **aderir** e **sair** de
   promoção (`DEAL` e `SMART`). Aderir um anúncio é uma operação em massa de tamanho 1 — não existe caminho
   unitário separado. Pausar, preço e estoque entram só depois do discovery com a Avil.
2. **Reverter = nova operação inversa.** Sem desfazer silencioso. "Reverter" cria outra operação (aderir ↔ sair)
   só sobre os itens aplicados, com preview e confirmação. Item que o ML não aceita mais aparece como não
   revertível.
3. **Preço na DEAL:** default = `suggested_discounted_price`, editável por item no preview (atalho "usar Até
   quanto descer"). Item com sugerido 🟡/🔴 vem desmarcado.
4. **Trava financeira:** 🔴 (líquido < custo) e ⚪ (sem líquido) podem entrar, mas vêm desmarcados e exigem
   confirmação separada no preview; a confirmação fica gravada no item da operação.
5. **Revalidação na execução:** antes de cada escrita, GET fresco do item. Não é mais convidado, preço fora da
   faixa ou semáforo pior que o confirmado → item termina "mudou desde o preview", sem escrita. Já participando
   → sucesso idempotente (cobre retry do QStash).
6. **Permissão:** só admin da org executa (mesma regra do ADR-0060). Membro comum vê e monta o preview. Suporte
   Daludi só com acesso total aprovado.
7. **Tela:** inicia no detalhe da campanha da Central (seleção → painel de preview → Executar); acompanha numa
   aba "Operações" dentro de Promoções (progresso, resultado por item, Reverter). Tela global de operações só
   quando existir o segundo tipo.
8. **Execução:** padrão do `sincronizar-promocoes` — QStash com continuação e orçamento de tempo por chamada.
9. **Conflito com UPDATE:** a Revisão avisa quando a família tem anúncio participando de promoção ("mudar o
   preço pode tirar da promoção"); não bloqueia.
10. **Prazo:** a 10.10 (adesão até 12/10) segue pelo Seller Center usando a Central para decidir. O motor mira as
    campanhas seguintes, sem atalho no spike nem na revisão.

## Pré-requisito: spike de escrita (antes do build)

1. Diego confere no DevCenter se "Promoções/ofertas" está em leitura + escrita; se mudar, reconecta a DSA.
2. Na **DSA** (org de teste), 1 anúncio convidado em DEAL e em SMART, MLB aprovado pelo Diego antes:
   `POST /seller-promotions/items/{id}` → GET confere → `DELETE ...?promotion_type=` → GET confere.
   A Avil não é tocada. Esta é uma escrita fora do fluxo do app, autorizada explicitamente para o spike.
3. Perguntas que o spike responde: payload aceito por tipo; erro com scope read-only; depois de sair da SMART, o
   ML inscreve de novo sozinho?; depois de sair, o anúncio volta a ser convidado?; mudar o preço base de item
   participando em DEAL: recusa ou remove?; rate limit de escrita.

### Resultado parcial do spike (2026-09-27, DSA, `MLB7553152348`)

- **Scope:** o token só passou a `offers:/read-write` depois de **reconectar** a conta. Mudar o DevCenter não
  basta e o refresh não atualiza o scope → reconexão vira passo de onboarding do módulo.
- **Aderir DEAL funciona:** `POST /seller-promotions/items/{id}?app_version=v2` com
  `{promotion_id, promotion_type:'DEAL', deal_price}` → **201** `{price, original_price, currency_id}`.
- **A visão por item atrasa:** `GET /seller-promotions/items/{id}` seguiu mostrando a DEAL como `candidate`
  (price 0) logo depois do 201 e só passou a `pending` minutos depois; a visão da campanha
  (`/promotions/{pid}/items?promotion_type=DEAL&item_id=`) mostrou `pending` na hora. Revalidação e conferência
  do motor leem a **visão da campanha**.
- **Sair de DEAL futura NÃO funcionou:** `DELETE ...?promotion_type=DEAL&promotion_id=` → **200 com corpo vazio**,
  e o item seguiu `pending` — tanto 3 s depois do POST quanto repetido ~40 min depois, com a inscrição já
  visível nas duas visões (descarta atraso de propagação). Com `deal_id` no lugar → 400 "Promotion id is
  required". **200 do DELETE não prova remoção.** Decisões 2 (Reverter) e 5 (idempotência) dependem de achar
  o caminho de saída.
- **Par User Product / catálogo:** o item testado (`catalog_listing: false`) e `MLB7553277320`
  (`catalog_listing: true`, "COMPETINDO") são o mesmo `user_product_id`, ligados por `item_relations`
  (estoque compartilhado). O Seller Center mostra promoções **só no item de catálogo** e marca o outro como
  "não elegível" — mas a API aceitou a inscrição nele, e ela **não aparece nem pode ser removida pelo Seller
  Center**. O motor precisa decidir em qual item do par inscrever (provavelmente o de catálogo) e nunca
  inscrever o que o Seller Center não mostra.
- Atenção a datas: a 10.10 vai de **28/09 a 13/10** (`start_date`); o `prazo_adesao` gravado pelo sync é o
  fim, não o início.
- A visão da campanha devolve **500 intermitente** (2 em ~25 leituras) → retry na leitura.
- **SMART não testada:** suspensa até a saída ser provada (preço vai ao ar na hora).

## Consequências

- O motor nasce com os requisitos reais de uma operação (promoção); o segundo tipo testa se ele é genérico de
  fato — não antes.
- A Black Friday passa a ser o primeiro uso previsto; a 10.10 continua manual.
- Se o spike mostrar que a escrita exige re-autorização, toda org que quiser aderir pelo app precisa reconectar
  a conta ML — vira passo de onboarding do módulo.

## Alternativas descartadas

- **V2 unitária antes, I5 depois:** retrabalho e inútil para 504 convidados.
- **I5 com preço/pausa primeiro:** sem discovery é aposta, e empurra promoções para depois da Black Friday.
- **Undo automático com janela:** escreve no ML sem nova confirmação (fere a regra de revisão humana).
- **Bloquear 🔴:** tira do app a queima de estoque intencional; confirmação explícita cobre o risco.
- **v1 mínimo para a 10.10:** estreia de escrita em massa numa campanha grande com prazo de 16 dias.
