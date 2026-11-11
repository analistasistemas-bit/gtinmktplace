# ADR-0203 — Galeria da cor: imagem inteira do gerador, planejada por IA

- **Status:** proposto (pivô decidido em 11/11/2026 e validado por medição em 12/11/2026)
- **Data:** 2026-11-12
- **Altera:** ADR-0201 (§2 conferência de dados em tela, §3 fatos confirmados pelo operador, §9 roteiro editável, §10 texto composto pelo sistema, §12 verificação da cena). O restante do ADR-0201 continua valendo: identidade por anúncio, cobrança por imagem exibida, trava de escrita no ML, aplicação por saga com desfazer, aprovação humana, Moda sem texto.

## Contexto

A galeria do ADR-0201 foi construída inteira e reprovada na validação real: o texto montado pelo sistema por cima da cena ficou com aparência amadora e o caminho em quatro passos (conferir dados, editar roteiro, gerar, aplicar) ficou pesado. O padrão de qualidade pedido é o de um agente que planeja o anúncio e pede ao gerador a imagem inteira, já com texto e layout.

Medição de 12/11/2026 (Fita Velcro Búfalo e Fio Amigurumi Círculo, Nano Banana 2.1 em 2K):

- com um bloco de estilo fixo no prompt, o gerador entrega layout e texto em português corretos e acentuados;
- um planejador de texto (gpt-6-luna, US$ 0,003) lê os dados e a foto do anúncio e devolve a paleta da marca e os 7 prompts; recusou sozinho dois dados em conflito entre a ficha do anúncio e a descrição do fornecedor;
- o gerador acrescenta texto não pedido em cerca de 3 de cada 7 imagens e embaralha a letra miúda do rótulo;
- o formato 4:5 em 2K sai em 1856×2304, a 3% de corte lateral do arquivo final de 1200×1540.

## Decisão

1. **Imagem inteira do gerador.** O gerador entrega a imagem final, com texto e layout. O sistema não compõe texto por cima. O navegador só ajusta o arquivo para 1200×1540 JPEG na aprovação.
2. **Plano por anúncio, feito por IA.** Uma chamada de IA de texto por anúncio devolve o plano: paleta (duas cores tiradas da embalagem ou da marca na foto), e 7 posições, cada uma com função, textos exatos e prompt. O plano vale para todas as cores do anúncio; a cor entra no prompt na hora de gerar e nunca aparece nos textos. O plano não é editável nem aprovado pelo operador.
3. **As 7 posições.** 1 capa sem texto; 2 em uso; 3 quebra da principal objeção; 4 benefícios; 5 ficha técnica; 6 como usar ou como escolher; 7 detalhes. A IA adapta a 3 e a 6 ao tipo de produto. Posição que os dados não sustentam fica indisponível, com o motivo. Em Moda nenhuma posição leva texto (ADR-0201 §11) e a IA só pede vistas que a foto de referência sustenta.
4. **Fonte dos dados.** O planejador recebe só a planilha (nome, descrição do fornecedor, marca), a ficha do anúncio lida no Mercado Livre (sem atributos de variação nem de embalagem) e a foto real. A descrição publicada (texto de IA) não entra. Fato que diverge entre as fontes fica fora. Não há mais passo de confirmação de fatos pelo operador.
5. **Guardas em código sobre o plano.** O plano é recusado se algum texto tiver termo proibido (lista do ADR-0201), número que não existe nos dados de entrada, nome de cor do anúncio, texto na capa ou em Moda, ou posição faltando. Plano recusado não reserva pedido nem gera custo.
6. **Conferência de texto por visão.** Cada imagem gerada tem o texto lido por visão e comparado com os textos do plano. Texto faltando (ou escrito errado) e texto a mais viram alerta no cartão. No gerador síncrono, a primeira divergência descarta a imagem e gera outra uma vez, antes de mostrar; a segunda é mostrada com o alerta. Imagem descartada não é exibida nem cobrada, e o custo dela fica somado na linha da imagem.
7. **Aprovação humana continua obrigatória** antes de qualquer imagem ir ao Mercado Livre. É a proteção final contra texto inventado e rótulo embaralhado.
8. **Tela única.** Uma página por anúncio: escolha da cor (ou todas), as 7 posições com Gerar por posição e Gerar todas, Aprovar e Gerar outra em cada imagem, e a aplicação no anúncio (adicionar ou substituir) com prévia e desfazer.
9. **Vigência.** O plano guarda o mesmo `fatos_hash` do ADR-0201 e o hash dos dados enviados ao planejador. Planilha, foto de referência ou ficha do anúncio mudou: o próximo pedido cria plano novo e as imagens do plano anterior ainda não aplicadas ficam desatualizadas. Como essas imagens já foram cobradas, a troca só acontece depois de o operador confirmar, vendo quantas imagens deixam de valer.
10. **Gerador padrão:** Nano Banana 2.1 em 2K, formato 4:5. Os modelos da Higgsfield seguem selecionáveis por organização, em 3:4 e sem a regeração automática.

## Alternativas descartadas

- **Manter o texto composto pelo sistema e melhorar o layout:** reprovado na validação real; não chega ao padrão pedido.
- **Plano editável pelo operador:** recria o passo pesado que motivou o pivô. O controle do operador é aprovar ou gerar outra.
- **Um plano por cor:** multiplicaria chamadas e deixaria cores do mesmo anúncio com textos diferentes.
- **Usar a descrição publicada como fonte:** ela traz promessas sem prova ("alta resistência", "não desfia").

## Consequências

- Saem de uso: tela de conferência de dados, roteiro editável, composição em canvas, lupa e recorte, leitura de etiqueta por visão. As tabelas ficam; nenhuma migration é necessária.
- O custo por imagem sobe de cerca de US$ 0,04 para US$ 0,06 (2K), mais a regeração automática. O preço por imagem cobrado do cliente é decisão comercial separada.
- O risco de texto errado passa a ser tratado por conferência automática mais aprovação humana, e não por construção.
- Letra miúda do rótulo pode sair embaralhada; o operador decide na aprovação.
