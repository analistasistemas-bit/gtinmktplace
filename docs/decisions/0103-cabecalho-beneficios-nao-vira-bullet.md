# ADR-0103 — `✅ BENEFÍCIOS` é cabeçalho, não item de lista

**Status:** Aceito
**Data:** 2026-08-04
**Decisores:** Diego
**Relaciona:** corrige defeito de `sanitizarDescricaoML`, introduzido junto com o template do
[ADR-0098](0098-copy-ancorada-na-fonte-e-persuasiva.md); irmão de
[ADR-0102](0102-descricao-sem-promessa-logistica.md) (mesma investigação), mas com **raio
totalmente diferente** — ver Consequências

## Contexto

`sanitizarDescricaoML` (`_shared/ml/criar-item.ts`) remove emojis antes de enviar a descrição ao
Mercado Livre, porque o ML os rejeita (`DESCRIPTION_PLAIN_TEXT_NOT_ALLOWED`). A regra tratava
`✔`, `✅` e `☑` como o mesmo caso — checkmark de lista — e convertia os três em `- `.

Só que no template do copywriter `✅` **não é bullet: é cabeçalho de seção**, ao lado de
`🧵 📌 🎯 ❓ 🎨 📦`. Os outros sete saíam limpos (viravam título em caixa alta); `✅ BENEFÍCIOS`
virava `- BENEFÍCIOS` — um título de seção disfarçado de item de lista, no meio de uma descrição
cujos outros títulos estavam corretos:

```
FITA DE CETIM

- BENEFÍCIOS          ← devia ser "BENEFÍCIOS"

- Macia
- Durável

ESPECIFICAÇÕES        ← correto
```

Encontrado ao gerar um anúncio completo para conferir o efeito do ADR-0102 — não por teste. Os
testes de `sanitizarDescricaoML` cobriam `✔` isolado e `🧵` isolado, nunca `✅`, e nunca uma
descrição inteira com cabeçalhos e bullets juntos.

### Medição antes de mudar

Este arquivo tem raio sobre todos os anúncios vivos (ver Consequências), então a premissa foi
verificada no catálogo em vez de assumida:

```sql
-- linhas que começam com ✅, em todas as descrições
✅ BENEFÍCIOS → 295 ocorrências
(nenhuma outra)
```

`✅` aparece em 295 descrições e **sempre** como `✅ BENEFÍCIOS`. Nunca em posição de bullet. Os
bullets do template são `✔ • - ▪` (declarado em `TOM E ESTILO`), então a separação é segura por
desenho, não só por observação.

## Decisão

Separar as duas regras: `✅` sai como qualquer emoji de cabeçalho; `✔` e `☑` continuam virando
`- `.

```ts
.replace(/✅️?[ \t]*/g, '')      // cabeçalho de seção
.replace(/[✔☑]️?[ \t]*/g, '- ') // bullet de lista
```

## Consequências

**Raio total — e é o que distingue este ADR do ADR-0102.** `sanitizarDescricaoML` roda em **todo**
envio ao ML: no CREATE (`garantirDescricaoML`) e no UPDATE (`resolverDescricaoUpdate`, chamado por
`sincronizarDescricao`). Diferente do ADR-0102, que só toca o prompt e portanto só afeta geração
nova, **esta mudança altera o texto de qualquer anúncio já publicado no próximo UPDATE** — as 295
descrições legadas contêm `✅ BENEFÍCIOS` e passarão a exibir `BENEFÍCIOS`.

Foi por isso que a correção saiu em PR separado do ADR-0102, e não como carona: um PR de raio zero
e um de raio total não devem compartilhar reversão.

A mudança é cosmética e sempre para melhor (título de seção deixa de parecer item de lista), mas
`resolverDescricaoUpdate` vai detectar diff e dar push — ou seja, gera tráfego de UPDATE que de
outro modo não existiria, para famílias cuja descrição não mudou em mais nada.

**Não muda:** os demais emojis, os bullets `✔ ☑ • ▪`, a estrutura das seções, e o reconhecimento
de cabeçalhos pelos guards de injeção (que operam sobre a descrição **antes** da sanitização, com
os emojis ainda presentes).

## Verificação

- Testes novos em `_shared/ml/__tests__/descricao.test.ts`: `✅` isolado, `✔`/`☑` isolados, e uma
  **descrição legada inteira** com cabeçalhos e bullets juntos — o caso que faltava e que teria
  apanhado o defeito.
- Suíte completa: 2461 testes, 295 arquivos, verde. `pnpm lint`: 0 erros.

## Como reverter

Voltar as duas linhas para `.replace(/[✔✅☑]️?[ \t]*/g, '- ')`. Os dois testes novos falham, que é o
comportamento esperado da reversão.
