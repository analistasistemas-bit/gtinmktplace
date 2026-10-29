export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      anuncios_externos: {
        Row: {
          atacado_erro: string | null
          atacado_status: string | null
          atualizado_em: string
          canal: Database["public"]["Enums"]["canal_externo"]
          codigo_pai: string
          criado_em: string
          erro_mensagem: string | null
          estado_desejado: string | null
          id: string
          item_externo_id: string | null
          marca_sync_em: string | null
          marca_sync_erro: string | null
          marca_sync_lease_ate: string | null
          marca_sync_status: string | null
          marca_sync_versao: number
          metadados_canal: Json
          migracao_pxv_erro: string | null
          migracao_pxv_snapshot: Json | null
          migracao_pxv_solicitada_em: string | null
          migracao_pxv_status: string | null
          migracao_pxv_tentativa: number
          ml_item_id_anterior: string | null
          mudando_composicao: boolean
          mudando_composicao_familia_id: string | null
          org_id: string
          particao: number
          permalink: string | null
          preco_override: number | null
          publicado_em: string | null
          qstash_message_id: string | null
          reconciliacao_tentativas: number
          skus_esperados: Json | null
          status: string
          titulo: string | null
          user_id: string
          variacoes_externas: Json
        }
        Insert: {
          atacado_erro?: string | null
          atacado_status?: string | null
          atualizado_em?: string
          canal: Database["public"]["Enums"]["canal_externo"]
          codigo_pai: string
          criado_em?: string
          erro_mensagem?: string | null
          estado_desejado?: string | null
          id?: string
          item_externo_id?: string | null
          marca_sync_em?: string | null
          marca_sync_erro?: string | null
          marca_sync_lease_ate?: string | null
          marca_sync_status?: string | null
          marca_sync_versao?: number
          metadados_canal?: Json
          migracao_pxv_erro?: string | null
          migracao_pxv_snapshot?: Json | null
          migracao_pxv_solicitada_em?: string | null
          migracao_pxv_status?: string | null
          migracao_pxv_tentativa?: number
          ml_item_id_anterior?: string | null
          mudando_composicao?: boolean
          mudando_composicao_familia_id?: string | null
          org_id: string
          particao?: number
          permalink?: string | null
          preco_override?: number | null
          publicado_em?: string | null
          qstash_message_id?: string | null
          reconciliacao_tentativas?: number
          skus_esperados?: Json | null
          status?: string
          titulo?: string | null
          user_id: string
          variacoes_externas?: Json
        }
        Update: {
          atacado_erro?: string | null
          atacado_status?: string | null
          atualizado_em?: string
          canal?: Database["public"]["Enums"]["canal_externo"]
          codigo_pai?: string
          criado_em?: string
          erro_mensagem?: string | null
          estado_desejado?: string | null
          id?: string
          item_externo_id?: string | null
          marca_sync_em?: string | null
          marca_sync_erro?: string | null
          marca_sync_lease_ate?: string | null
          marca_sync_status?: string | null
          marca_sync_versao?: number
          metadados_canal?: Json
          migracao_pxv_erro?: string | null
          migracao_pxv_snapshot?: Json | null
          migracao_pxv_solicitada_em?: string | null
          migracao_pxv_status?: string | null
          migracao_pxv_tentativa?: number
          ml_item_id_anterior?: string | null
          mudando_composicao?: boolean
          mudando_composicao_familia_id?: string | null
          org_id?: string
          particao?: number
          permalink?: string | null
          preco_override?: number | null
          publicado_em?: string | null
          qstash_message_id?: string | null
          reconciliacao_tentativas?: number
          skus_esperados?: Json | null
          status?: string
          titulo?: string | null
          user_id?: string
          variacoes_externas?: Json
        }
        Relationships: [
          {
            foreignKeyName: "anuncios_externos_mudando_composicao_familia_id_fkey"
            columns: ["mudando_composicao_familia_id"]
            isOneToOne: false
            referencedRelation: "familias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anuncios_externos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      anuncios_externos_itens: {
        Row: {
          anuncio_externo_id: string
          atualizado_em: string
          catalog_erro: string | null
          catalog_listing_id: string | null
          catalog_product_id: string | null
          catalog_status: string | null
          criado_em: string
          family_id: string | null
          id: string
          item_externo_id: string | null
          org_id: string
          permalink: string | null
          retirado: boolean
          sku: string
          status: string
          user_product_id: string | null
          variacao_id: string | null
        }
        Insert: {
          anuncio_externo_id: string
          atualizado_em?: string
          catalog_erro?: string | null
          catalog_listing_id?: string | null
          catalog_product_id?: string | null
          catalog_status?: string | null
          criado_em?: string
          family_id?: string | null
          id?: string
          item_externo_id?: string | null
          org_id: string
          permalink?: string | null
          retirado?: boolean
          sku: string
          status: string
          user_product_id?: string | null
          variacao_id?: string | null
        }
        Update: {
          anuncio_externo_id?: string
          atualizado_em?: string
          catalog_erro?: string | null
          catalog_listing_id?: string | null
          catalog_product_id?: string | null
          catalog_status?: string | null
          criado_em?: string
          family_id?: string | null
          id?: string
          item_externo_id?: string | null
          org_id?: string
          permalink?: string | null
          retirado?: boolean
          sku?: string
          status?: string
          user_product_id?: string | null
          variacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "anuncios_externos_itens_pai_fk"
            columns: ["anuncio_externo_id", "org_id"]
            isOneToOne: false
            referencedRelation: "anuncios_externos"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "anuncios_externos_itens_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "variacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          ai_model_imagem: string | null
          ai_model_texto: string | null
          alertas_promocoes_ativo: boolean
          aliquota_importado_pct: number
          aliquota_interna_pct: number | null
          aliquota_nacional_pct: number
          aliquotas_confirmadas_em: string | null
          atualizado_em: string
          criado_em: string
          desconto_concorrencia_pct: number
          desconto_pct: number
          monitor_frete_ativo: boolean
          mostrar_lucro_dashboard: boolean
          org_id: string
          reancora_lider_ativa: boolean
          telegram_ativo: boolean
          telegram_bot_id: number | null
          telegram_bot_token: string | null
          telegram_chat_id: string | null
          uf_empresa: string | null
          user_id: string | null
        }
        Insert: {
          ai_model_imagem?: string | null
          ai_model_texto?: string | null
          alertas_promocoes_ativo?: boolean
          aliquota_importado_pct?: number
          aliquota_interna_pct?: number | null
          aliquota_nacional_pct?: number
          aliquotas_confirmadas_em?: string | null
          atualizado_em?: string
          criado_em?: string
          desconto_concorrencia_pct?: number
          desconto_pct?: number
          monitor_frete_ativo?: boolean
          mostrar_lucro_dashboard?: boolean
          org_id: string
          reancora_lider_ativa?: boolean
          telegram_ativo?: boolean
          telegram_bot_id?: number | null
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          uf_empresa?: string | null
          user_id?: string | null
        }
        Update: {
          ai_model_imagem?: string | null
          ai_model_texto?: string | null
          alertas_promocoes_ativo?: boolean
          aliquota_importado_pct?: number
          aliquota_interna_pct?: number | null
          aliquota_nacional_pct?: number
          aliquotas_confirmadas_em?: string | null
          atualizado_em?: string
          criado_em?: string
          desconto_concorrencia_pct?: number
          desconto_pct?: number
          monitor_frete_ativo?: boolean
          mostrar_lucro_dashboard?: boolean
          org_id?: string
          reancora_lider_ativa?: boolean
          telegram_ativo?: boolean
          telegram_bot_id?: number | null
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          uf_empresa?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "configuracoes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_fiscal: {
        Row: {
          atualizado_em: string
          bairro: string | null
          cep: string | null
          cfop_dentro_uf: string | null
          cfop_fora_uf_contribuinte: string | null
          cfop_fora_uf_nao_contribuinte: string | null
          cnpj: string | null
          complemento: string | null
          criado_em: string
          csosn_padrao_revenda: string | null
          cst_cofins: string | null
          cst_pis: string | null
          emissao_a_partir_de: string | null
          inscricao_estadual: string | null
          logradouro: string | null
          municipio: string | null
          municipio_ibge: string | null
          natureza_operacao: string | null
          nome_fantasia: string | null
          numero: string | null
          org_id: string
          origin_type: string | null
          razao_social: string | null
          regime_tributario: string | null
          uf: string | null
        }
        Insert: {
          atualizado_em?: string
          bairro?: string | null
          cep?: string | null
          cfop_dentro_uf?: string | null
          cfop_fora_uf_contribuinte?: string | null
          cfop_fora_uf_nao_contribuinte?: string | null
          cnpj?: string | null
          complemento?: string | null
          criado_em?: string
          csosn_padrao_revenda?: string | null
          cst_cofins?: string | null
          cst_pis?: string | null
          emissao_a_partir_de?: string | null
          inscricao_estadual?: string | null
          logradouro?: string | null
          municipio?: string | null
          municipio_ibge?: string | null
          natureza_operacao?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          org_id: string
          origin_type?: string | null
          razao_social?: string | null
          regime_tributario?: string | null
          uf?: string | null
        }
        Update: {
          atualizado_em?: string
          bairro?: string | null
          cep?: string | null
          cfop_dentro_uf?: string | null
          cfop_fora_uf_contribuinte?: string | null
          cfop_fora_uf_nao_contribuinte?: string | null
          cnpj?: string | null
          complemento?: string | null
          criado_em?: string
          csosn_padrao_revenda?: string | null
          cst_cofins?: string | null
          cst_pis?: string | null
          emissao_a_partir_de?: string | null
          inscricao_estadual?: string | null
          logradouro?: string | null
          municipio?: string | null
          municipio_ibge?: string | null
          natureza_operacao?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          org_id?: string
          origin_type?: string | null
          razao_social?: string | null
          regime_tributario?: string | null
          uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresa_fiscal_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_movimentos: {
        Row: {
          alertado_em: string | null
          canal_origem: string | null
          codigo: string
          codigo_pai: string
          criado_em: string
          criado_por: string | null
          custo_unitario: number | null
          documento: string | null
          estoque_anterior: number | null
          estoque_resultante: number | null
          id: string
          motivo: string
          observacao: string | null
          ordem: number | null
          org_id: string
          origem_kit_codigo_pai: string | null
          origem_kit_multiplicador: number | null
          push_canal_origem: string | null
          push_enfileirado_em: string | null
          quantidade: number
          quantidade_pedida: number | null
          referencia_externa: string | null
        }
        Insert: {
          alertado_em?: string | null
          canal_origem?: string | null
          codigo: string
          codigo_pai?: string
          criado_em?: string
          criado_por?: string | null
          custo_unitario?: number | null
          documento?: string | null
          estoque_anterior?: number | null
          estoque_resultante?: number | null
          id?: string
          motivo: string
          observacao?: string | null
          ordem?: number | null
          org_id: string
          origem_kit_codigo_pai?: string | null
          origem_kit_multiplicador?: number | null
          push_canal_origem?: string | null
          push_enfileirado_em?: string | null
          quantidade: number
          quantidade_pedida?: number | null
          referencia_externa?: string | null
        }
        Update: {
          alertado_em?: string | null
          canal_origem?: string | null
          codigo?: string
          codigo_pai?: string
          criado_em?: string
          criado_por?: string | null
          custo_unitario?: number | null
          documento?: string | null
          estoque_anterior?: number | null
          estoque_resultante?: number | null
          id?: string
          motivo?: string
          observacao?: string | null
          ordem?: number | null
          org_id?: string
          origem_kit_codigo_pai?: string | null
          origem_kit_multiplicador?: number | null
          push_canal_origem?: string | null
          push_enfileirado_em?: string | null
          quantidade?: number
          quantidade_pedida?: number | null
          referencia_externa?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_movimentos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      extensao_erros_leitura: {
        Row: {
          atualizado_em: string
          dia: string
          motivo: string
          ocorrencias: number
          org_id: string
          tipo_pagina: string
          ultimo_ml_item_id: string | null
          versao_extensao: string
        }
        Insert: {
          atualizado_em?: string
          dia: string
          motivo: string
          ocorrencias?: number
          org_id: string
          tipo_pagina: string
          ultimo_ml_item_id?: string | null
          versao_extensao: string
        }
        Update: {
          atualizado_em?: string
          dia?: string
          motivo?: string
          ocorrencias?: number
          org_id?: string
          tipo_pagina?: string
          ultimo_ml_item_id?: string | null
          versao_extensao?: string
        }
        Relationships: [
          {
            foreignKeyName: "extensao_erros_leitura_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      extensao_uso_diario: {
        Row: {
          analises: number
          dia: string
          org_id: string
          tipo_pagina: string
          user_id: string
        }
        Insert: {
          analises?: number
          dia: string
          org_id: string
          tipo_pagina: string
          user_id: string
        }
        Update: {
          analises?: number
          dia?: string
          org_id?: string
          tipo_pagina?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extensao_uso_diario_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      extensao_vinculos: {
        Row: {
          atualizado_em: string | null
          chave: string
          chave_tipo: string
          criado_em: string
          criado_por: string | null
          id: string
          org_id: string
          variacao_id: string
        }
        Insert: {
          atualizado_em?: string | null
          chave: string
          chave_tipo: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          org_id: string
          variacao_id: string
        }
        Update: {
          atualizado_em?: string | null
          chave?: string
          chave_tipo?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          org_id?: string
          variacao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extensao_vinculos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extensao_vinculos_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "variacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      familias: {
        Row: {
          analise_mercado: Json | null
          atacado: Json | null
          atacado_erro: string | null
          atacado_status: string | null
          atributos_editados_pelo_operador: boolean
          atributos_faltantes: Json | null
          atributos_ml: Json
          atualizado_em: string
          can_invoice: boolean | null
          can_invoice_causa: string | null
          can_invoice_em: string | null
          capa_ml_picture_id: string | null
          capa_storage_path: string | null
          capa2_ml_picture_id: string | null
          capa2_storage_path: string | null
          capa3_ml_picture_id: string | null
          capa3_storage_path: string | null
          catalogo_categoria_sugerida_id: string | null
          catalogo_categoria_sugerida_nome: string | null
          catalogo_categoria_sugerida_vendedores: number | null
          categoria_ml_id: string | null
          categoria_nome: string | null
          cest: string | null
          chave_cadastro: string | null
          codigo_pai: string
          concorrencia_categoria_id: string | null
          concorrencia_classe: Database["public"]["Enums"]["classe_concorrencia"]
          concorrencia_origem: Database["public"]["Enums"]["origem_concorrencia"]
          concorrencia_preco_min: number | null
          concorrencia_vendedores: number
          criado_em: string
          custo_centavos: number | null
          desconto_pct: number | null
          descricao_editada_pelo_operador: boolean
          descricao_erro: string | null
          descricao_fiscal: string | null
          descricao_ml: string | null
          descricao_pai: string | null
          descricao_status: string | null
          editado_em: string | null
          erro_mensagem: string | null
          estrategia_motivo: string | null
          estrategia_preco:
            | Database["public"]["Enums"]["estrategia_preco"]
            | null
          ex_tipi: string | null
          exibir_com_desconto: boolean
          fci: string | null
          fiscal_sincronizado_em: string | null
          fornecedor: string | null
          frete_gratis: boolean
          genero: string | null
          grade_tamanho: string | null
          id: string
          kit_base_codigo_pai: string | null
          kit_multiplicador: number | null
          lote_id: string
          marca: string | null
          ml_item_id: string | null
          ml_permalink: string | null
          mudanca_estrutural: Json | null
          ncm: string | null
          nome_pai: string
          observacao_operador: string | null
          operacao: Database["public"]["Enums"]["operacao_ml"]
          org_id: string
          origem: Database["public"]["Enums"]["origem_produto"]
          origem_cadastro: string | null
          origem_nfe: number | null
          preco_reancorado_lider: boolean
          publicado_em: string | null
          qstash_message_id: string | null
          sale_terms: Json
          shipping_mode: string
          status: Database["public"]["Enums"]["familia_status"]
          tipo_aviamento: Database["public"]["Enums"]["tipo_aviamento"] | null
          tipo_origem: Database["public"]["Enums"]["tipo_origem"] | null
          titulo_descartes: Json | null
          titulo_editado_pelo_operador: boolean
          titulo_ml: string | null
          tokens_input: number | null
          tokens_output: number | null
          tributacao_icms: string | null
          tributacao_icms_regime: string | null
          unidade: string | null
          user_id: string
          variacao_principal_codigo: string | null
        }
        Insert: {
          analise_mercado?: Json | null
          atacado?: Json | null
          atacado_erro?: string | null
          atacado_status?: string | null
          atributos_editados_pelo_operador?: boolean
          atributos_faltantes?: Json | null
          atributos_ml?: Json
          atualizado_em?: string
          can_invoice?: boolean | null
          can_invoice_causa?: string | null
          can_invoice_em?: string | null
          capa_ml_picture_id?: string | null
          capa_storage_path?: string | null
          capa2_ml_picture_id?: string | null
          capa2_storage_path?: string | null
          capa3_ml_picture_id?: string | null
          capa3_storage_path?: string | null
          catalogo_categoria_sugerida_id?: string | null
          catalogo_categoria_sugerida_nome?: string | null
          catalogo_categoria_sugerida_vendedores?: number | null
          categoria_ml_id?: string | null
          categoria_nome?: string | null
          cest?: string | null
          chave_cadastro?: string | null
          codigo_pai: string
          concorrencia_categoria_id?: string | null
          concorrencia_classe?: Database["public"]["Enums"]["classe_concorrencia"]
          concorrencia_origem?: Database["public"]["Enums"]["origem_concorrencia"]
          concorrencia_preco_min?: number | null
          concorrencia_vendedores?: number
          criado_em?: string
          custo_centavos?: number | null
          desconto_pct?: number | null
          descricao_editada_pelo_operador?: boolean
          descricao_erro?: string | null
          descricao_fiscal?: string | null
          descricao_ml?: string | null
          descricao_pai?: string | null
          descricao_status?: string | null
          editado_em?: string | null
          erro_mensagem?: string | null
          estrategia_motivo?: string | null
          estrategia_preco?:
            | Database["public"]["Enums"]["estrategia_preco"]
            | null
          ex_tipi?: string | null
          exibir_com_desconto?: boolean
          fci?: string | null
          fiscal_sincronizado_em?: string | null
          fornecedor?: string | null
          frete_gratis?: boolean
          genero?: string | null
          grade_tamanho?: string | null
          id?: string
          kit_base_codigo_pai?: string | null
          kit_multiplicador?: number | null
          lote_id: string
          marca?: string | null
          ml_item_id?: string | null
          ml_permalink?: string | null
          mudanca_estrutural?: Json | null
          ncm?: string | null
          nome_pai: string
          observacao_operador?: string | null
          operacao: Database["public"]["Enums"]["operacao_ml"]
          org_id: string
          origem?: Database["public"]["Enums"]["origem_produto"]
          origem_cadastro?: string | null
          origem_nfe?: number | null
          preco_reancorado_lider?: boolean
          publicado_em?: string | null
          qstash_message_id?: string | null
          sale_terms?: Json
          shipping_mode?: string
          status?: Database["public"]["Enums"]["familia_status"]
          tipo_aviamento?: Database["public"]["Enums"]["tipo_aviamento"] | null
          tipo_origem?: Database["public"]["Enums"]["tipo_origem"] | null
          titulo_descartes?: Json | null
          titulo_editado_pelo_operador?: boolean
          titulo_ml?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          tributacao_icms?: string | null
          tributacao_icms_regime?: string | null
          unidade?: string | null
          user_id: string
          variacao_principal_codigo?: string | null
        }
        Update: {
          analise_mercado?: Json | null
          atacado?: Json | null
          atacado_erro?: string | null
          atacado_status?: string | null
          atributos_editados_pelo_operador?: boolean
          atributos_faltantes?: Json | null
          atributos_ml?: Json
          atualizado_em?: string
          can_invoice?: boolean | null
          can_invoice_causa?: string | null
          can_invoice_em?: string | null
          capa_ml_picture_id?: string | null
          capa_storage_path?: string | null
          capa2_ml_picture_id?: string | null
          capa2_storage_path?: string | null
          capa3_ml_picture_id?: string | null
          capa3_storage_path?: string | null
          catalogo_categoria_sugerida_id?: string | null
          catalogo_categoria_sugerida_nome?: string | null
          catalogo_categoria_sugerida_vendedores?: number | null
          categoria_ml_id?: string | null
          categoria_nome?: string | null
          cest?: string | null
          chave_cadastro?: string | null
          codigo_pai?: string
          concorrencia_categoria_id?: string | null
          concorrencia_classe?: Database["public"]["Enums"]["classe_concorrencia"]
          concorrencia_origem?: Database["public"]["Enums"]["origem_concorrencia"]
          concorrencia_preco_min?: number | null
          concorrencia_vendedores?: number
          criado_em?: string
          custo_centavos?: number | null
          desconto_pct?: number | null
          descricao_editada_pelo_operador?: boolean
          descricao_erro?: string | null
          descricao_fiscal?: string | null
          descricao_ml?: string | null
          descricao_pai?: string | null
          descricao_status?: string | null
          editado_em?: string | null
          erro_mensagem?: string | null
          estrategia_motivo?: string | null
          estrategia_preco?:
            | Database["public"]["Enums"]["estrategia_preco"]
            | null
          ex_tipi?: string | null
          exibir_com_desconto?: boolean
          fci?: string | null
          fiscal_sincronizado_em?: string | null
          fornecedor?: string | null
          frete_gratis?: boolean
          genero?: string | null
          grade_tamanho?: string | null
          id?: string
          kit_base_codigo_pai?: string | null
          kit_multiplicador?: number | null
          lote_id?: string
          marca?: string | null
          ml_item_id?: string | null
          ml_permalink?: string | null
          mudanca_estrutural?: Json | null
          ncm?: string | null
          nome_pai?: string
          observacao_operador?: string | null
          operacao?: Database["public"]["Enums"]["operacao_ml"]
          org_id?: string
          origem?: Database["public"]["Enums"]["origem_produto"]
          origem_cadastro?: string | null
          origem_nfe?: number | null
          preco_reancorado_lider?: boolean
          publicado_em?: string | null
          qstash_message_id?: string | null
          sale_terms?: Json
          shipping_mode?: string
          status?: Database["public"]["Enums"]["familia_status"]
          tipo_aviamento?: Database["public"]["Enums"]["tipo_aviamento"] | null
          tipo_origem?: Database["public"]["Enums"]["tipo_origem"] | null
          titulo_descartes?: Json | null
          titulo_editado_pelo_operador?: boolean
          titulo_ml?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          tributacao_icms?: string | null
          tributacao_icms_regime?: string | null
          unidade?: string | null
          user_id?: string
          variacao_principal_codigo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "familias_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "familias_ncm_oficial_fk"
            columns: ["ncm"]
            isOneToOne: false
            referencedRelation: "ncm_oficial"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "familias_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventario_corte_backfill: {
        Row: {
          ate_ordem: number
          codigo: string
          org_id: string
        }
        Insert: {
          ate_ordem: number
          codigo: string
          org_id: string
        }
        Update: {
          ate_ordem?: number
          codigo?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventario_corte_backfill_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventarios: {
        Row: {
          cnpj: string | null
          confirmado_em: string | null
          confirmado_por: string | null
          data_base: string
          erro: string | null
          gerado_em: string
          id: string
          inscricao_estadual: string | null
          org_id: string
          origem: string
          razao_social: string | null
          status: string
          versao: number
        }
        Insert: {
          cnpj?: string | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          data_base: string
          erro?: string | null
          gerado_em: string
          id?: string
          inscricao_estadual?: string | null
          org_id: string
          origem: string
          razao_social?: string | null
          status: string
          versao?: number
        }
        Update: {
          cnpj?: string | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          data_base?: string
          erro?: string | null
          gerado_em?: string
          id?: string
          inscricao_estadual?: string | null
          org_id?: string
          origem?: string
          razao_social?: string | null
          status?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventarios_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventarios_itens: {
        Row: {
          codigo: string
          codigo_pai: string
          cor: string | null
          custo_medio: number | null
          descricao: string | null
          id: string
          inventario_id: string
          justificativa: string | null
          marcas: string[]
          ncm: string | null
          org_id: string
          qtd_final: number | null
          qtd_sem_nota: number
          qtd_sem_nota_final: number | null
          qtd_valorizada: number
          qtd_valorizada_final: number | null
          quantidade_contada: number | null
          quantidade_sistema: number
          tamanho: string | null
          unidade: string | null
          valor_final: number | null
          valor_total: number
        }
        Insert: {
          codigo: string
          codigo_pai: string
          cor?: string | null
          custo_medio?: number | null
          descricao?: string | null
          id?: string
          inventario_id: string
          justificativa?: string | null
          marcas?: string[]
          ncm?: string | null
          org_id: string
          qtd_final?: number | null
          qtd_sem_nota: number
          qtd_sem_nota_final?: number | null
          qtd_valorizada: number
          qtd_valorizada_final?: number | null
          quantidade_contada?: number | null
          quantidade_sistema: number
          tamanho?: string | null
          unidade?: string | null
          valor_final?: number | null
          valor_total: number
        }
        Update: {
          codigo?: string
          codigo_pai?: string
          cor?: string | null
          custo_medio?: number | null
          descricao?: string | null
          id?: string
          inventario_id?: string
          justificativa?: string | null
          marcas?: string[]
          ncm?: string | null
          org_id?: string
          qtd_final?: number | null
          qtd_sem_nota?: number
          qtd_sem_nota_final?: number | null
          qtd_valorizada?: number
          qtd_valorizada_final?: number | null
          quantidade_contada?: number | null
          quantidade_sistema?: number
          tamanho?: string | null
          unidade?: string | null
          valor_final?: number | null
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventarios_itens_inventario_id_org_id_fkey"
            columns: ["inventario_id", "org_id"]
            isOneToOne: false
            referencedRelation: "inventarios"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      kits_virtuais: {
        Row: {
          atualizado_em: string
          chave_cadastro: string
          criado_em: string
          criado_por: string | null
          desconto_pct: number
          descricao: string | null
          encerrado_em: string | null
          erro_mensagem: string | null
          foto_ml_picture_id: string | null
          foto_storage_path: string | null
          id: string
          listing_type_id: string
          ml_item_id: string | null
          ml_permalink: string | null
          ml_user_product_id: string | null
          org_id: string
          publicado_em: string | null
          status: string
          titulo: string
        }
        Insert: {
          atualizado_em?: string
          chave_cadastro: string
          criado_em?: string
          criado_por?: string | null
          desconto_pct: number
          descricao?: string | null
          encerrado_em?: string | null
          erro_mensagem?: string | null
          foto_ml_picture_id?: string | null
          foto_storage_path?: string | null
          id?: string
          listing_type_id?: string
          ml_item_id?: string | null
          ml_permalink?: string | null
          ml_user_product_id?: string | null
          org_id: string
          publicado_em?: string | null
          status: string
          titulo: string
        }
        Update: {
          atualizado_em?: string
          chave_cadastro?: string
          criado_em?: string
          criado_por?: string | null
          desconto_pct?: number
          descricao?: string | null
          encerrado_em?: string | null
          erro_mensagem?: string | null
          foto_ml_picture_id?: string | null
          foto_storage_path?: string | null
          id?: string
          listing_type_id?: string
          ml_item_id?: string | null
          ml_permalink?: string | null
          ml_user_product_id?: string | null
          org_id?: string
          publicado_em?: string | null
          status?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "kits_virtuais_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kits_virtuais_componentes: {
        Row: {
          codigo: string | null
          codigo_pai: string | null
          criado_em: string
          id: string
          item_externo_id: string | null
          kit_id: string
          ordem: number
          org_id: string
          quantidade: number
          user_product_id: string
        }
        Insert: {
          codigo?: string | null
          codigo_pai?: string | null
          criado_em?: string
          id?: string
          item_externo_id?: string | null
          kit_id: string
          ordem: number
          org_id: string
          quantidade: number
          user_product_id: string
        }
        Update: {
          codigo?: string | null
          codigo_pai?: string | null
          criado_em?: string
          id?: string
          item_externo_id?: string | null
          kit_id?: string
          ordem?: number
          org_id?: string
          quantidade?: number
          user_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kits_virtuais_componentes_kit_fk"
            columns: ["kit_id", "org_id"]
            isOneToOne: false
            referencedRelation: "kits_virtuais"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      lotes: {
        Row: {
          anomalias_planilha: Json
          atacado_default: Json | null
          atualizado_em: string
          criado_em: string
          erro_mensagem: string | null
          id: string
          imagens_paths: string[]
          numero: number
          numero_org: number | null
          org_id: string
          origem: string
          planilha_path: string | null
          status: Database["public"]["Enums"]["lote_status"]
          total_erros: number
          total_familias: number
          total_publicadas: number
          user_id: string
        }
        Insert: {
          anomalias_planilha?: Json
          atacado_default?: Json | null
          atualizado_em?: string
          criado_em?: string
          erro_mensagem?: string | null
          id?: string
          imagens_paths?: string[]
          numero?: number
          numero_org?: number | null
          org_id: string
          origem?: string
          planilha_path?: string | null
          status?: Database["public"]["Enums"]["lote_status"]
          total_erros?: number
          total_familias?: number
          total_publicadas?: number
          user_id: string
        }
        Update: {
          anomalias_planilha?: Json
          atacado_default?: Json | null
          atualizado_em?: string
          criado_em?: string
          erro_mensagem?: string | null
          id?: string
          imagens_paths?: string[]
          numero?: number
          numero_org?: number | null
          org_id?: string
          origem?: string
          planilha_path?: string | null
          status?: Database["public"]["Enums"]["lote_status"]
          total_erros?: number
          total_familias?: number
          total_publicadas?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lotes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_connections: {
        Row: {
          access_token_secret_id: string | null
          atualizado_em: string
          auth_alerta_em: string | null
          canal: Database["public"]["Enums"]["canal_externo"]
          conta_externa_id: string | null
          conta_label: string | null
          criado_em: string
          criado_por: string | null
          expires_at: string | null
          id: string
          me2_habilitado: boolean | null
          org_id: string
          refresh_token_secret_id: string | null
          scope: string | null
          ultima_sincronizacao_ok_em: string | null
        }
        Insert: {
          access_token_secret_id?: string | null
          atualizado_em?: string
          auth_alerta_em?: string | null
          canal: Database["public"]["Enums"]["canal_externo"]
          conta_externa_id?: string | null
          conta_label?: string | null
          criado_em?: string
          criado_por?: string | null
          expires_at?: string | null
          id?: string
          me2_habilitado?: boolean | null
          org_id: string
          refresh_token_secret_id?: string | null
          scope?: string | null
          ultima_sincronizacao_ok_em?: string | null
        }
        Update: {
          access_token_secret_id?: string | null
          atualizado_em?: string
          auth_alerta_em?: string | null
          canal?: Database["public"]["Enums"]["canal_externo"]
          conta_externa_id?: string | null
          conta_label?: string | null
          criado_em?: string
          criado_por?: string | null
          expires_at?: string | null
          id?: string
          me2_habilitado?: boolean | null
          org_id?: string
          refresh_token_secret_id?: string | null
          scope?: string | null
          ultima_sincronizacao_ok_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_ads_conta_dia: {
        Row: {
          clicks: number
          coletado_em: string
          cost: number
          dia: string
          direct_amount: number
          indirect_amount: number
          org_id: string
          prints: number
          total_amount: number
        }
        Insert: {
          clicks: number
          coletado_em: string
          cost: number
          dia: string
          direct_amount: number
          indirect_amount: number
          org_id: string
          prints: number
          total_amount: number
        }
        Update: {
          clicks?: number
          coletado_em?: string
          cost?: number
          dia?: string
          direct_amount?: number
          indirect_amount?: number
          org_id?: string
          prints?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "ml_ads_conta_dia_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_ads_grupo: {
        Row: {
          ad_group_id: number
          atualizado_em: string
          campaign_id: number | null
          external_id: string | null
          org_id: string
          status: string
          tipo: string
        }
        Insert: {
          ad_group_id: number
          atualizado_em: string
          campaign_id?: number | null
          external_id?: string | null
          org_id: string
          status: string
          tipo: string
        }
        Update: {
          ad_group_id?: number
          atualizado_em?: string
          campaign_id?: number | null
          external_id?: string | null
          org_id?: string
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_ads_grupo_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_ads_grupo_dia: {
        Row: {
          ad_group_id: number
          clicks: number
          coletado_em: string
          cost: number
          dia: string
          direct_amount: number
          direct_units: number
          indirect_amount: number
          org_id: string
          prints: number
          total_amount: number
          units: number
        }
        Insert: {
          ad_group_id: number
          clicks: number
          coletado_em: string
          cost: number
          dia: string
          direct_amount: number
          direct_units: number
          indirect_amount: number
          org_id: string
          prints: number
          total_amount: number
          units: number
        }
        Update: {
          ad_group_id?: number
          clicks?: number
          coletado_em?: string
          cost?: number
          dia?: string
          direct_amount?: number
          direct_units?: number
          indirect_amount?: number
          org_id?: string
          prints?: number
          total_amount?: number
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "ml_ads_grupo_dia_org_id_ad_group_id_fkey"
            columns: ["org_id", "ad_group_id"]
            isOneToOne: false
            referencedRelation: "ml_ads_grupo"
            referencedColumns: ["org_id", "ad_group_id"]
          },
        ]
      }
      ml_ads_grupo_item: {
        Row: {
          ad_group_id: number
          ml_item_id: string
          org_id: string
          visto_em: string
        }
        Insert: {
          ad_group_id: number
          ml_item_id: string
          org_id: string
          visto_em: string
        }
        Update: {
          ad_group_id?: number
          ml_item_id?: string
          org_id?: string
          visto_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_ads_grupo_item_org_id_ad_group_id_fkey"
            columns: ["org_id", "ad_group_id"]
            isOneToOne: false
            referencedRelation: "ml_ads_grupo"
            referencedColumns: ["org_id", "ad_group_id"]
          },
        ]
      }
      ml_ads_sync: {
        Row: {
          advertiser_id: number | null
          carga_inicial_ok: boolean
          cobertura_desde: string | null
          conta_cobertura_desde: string | null
          cursor: string | null
          custo_listado: number | null
          custo_resumo: number | null
          erro: string | null
          estado: string
          iniciado_em: string | null
          org_id: string
          posse_ate: string | null
          rodada: string | null
          ultimo_erro_em: string | null
          ultimo_ok_em: string | null
        }
        Insert: {
          advertiser_id?: number | null
          carga_inicial_ok?: boolean
          cobertura_desde?: string | null
          conta_cobertura_desde?: string | null
          cursor?: string | null
          custo_listado?: number | null
          custo_resumo?: number | null
          erro?: string | null
          estado: string
          iniciado_em?: string | null
          org_id: string
          posse_ate?: string | null
          rodada?: string | null
          ultimo_erro_em?: string | null
          ultimo_ok_em?: string | null
        }
        Update: {
          advertiser_id?: number | null
          carga_inicial_ok?: boolean
          cobertura_desde?: string | null
          conta_cobertura_desde?: string | null
          cursor?: string | null
          custo_listado?: number | null
          custo_resumo?: number | null
          erro?: string | null
          estado?: string
          iniciado_em?: string | null
          org_id?: string
          posse_ate?: string | null
          rodada?: string | null
          ultimo_erro_em?: string | null
          ultimo_ok_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_ads_sync_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_credentials: {
        Row: {
          access_token_secret_id: string
          atualizado_em: string
          criado_em: string
          expires_at: string
          ml_nickname: string | null
          ml_user_id: string
          org_id: string
          refresh_token_secret_id: string
          scope: string | null
          user_id: string
        }
        Insert: {
          access_token_secret_id: string
          atualizado_em?: string
          criado_em?: string
          expires_at: string
          ml_nickname?: string | null
          ml_user_id: string
          org_id: string
          refresh_token_secret_id: string
          scope?: string | null
          user_id: string
        }
        Update: {
          access_token_secret_id?: string
          atualizado_em?: string
          criado_em?: string
          expires_at?: string
          ml_nickname?: string | null
          ml_user_id?: string
          org_id?: string
          refresh_token_secret_id?: string
          scope?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_credentials_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_devolucoes: {
        Row: {
          aberto_em: string | null
          acoes_pendentes: Json | null
          afeta_reputacao: string | null
          atualizado_em: string
          claim_id: number
          criado_em: string
          detalhe: Json | null
          enriquecido_em: string | null
          fechado_em: string | null
          id: string
          lido_em: string | null
          order_id: number | null
          org_id: string
          pedidos_devolucao: Json | null
          prazo: string | null
          rastreio: string | null
          raw: Json | null
          reason_id: string | null
          reason_texto: string | null
          return_id: number | null
          return_status: string | null
          return_status_money: string | null
          revisao_pendente: boolean
          revisao_status: string | null
          stage: string | null
          status: string | null
          type: string | null
          user_id: string
          valor_em_jogo: number | null
          vez_de: string | null
        }
        Insert: {
          aberto_em?: string | null
          acoes_pendentes?: Json | null
          afeta_reputacao?: string | null
          atualizado_em?: string
          claim_id: number
          criado_em?: string
          detalhe?: Json | null
          enriquecido_em?: string | null
          fechado_em?: string | null
          id?: string
          lido_em?: string | null
          order_id?: number | null
          org_id: string
          pedidos_devolucao?: Json | null
          prazo?: string | null
          rastreio?: string | null
          raw?: Json | null
          reason_id?: string | null
          reason_texto?: string | null
          return_id?: number | null
          return_status?: string | null
          return_status_money?: string | null
          revisao_pendente?: boolean
          revisao_status?: string | null
          stage?: string | null
          status?: string | null
          type?: string | null
          user_id: string
          valor_em_jogo?: number | null
          vez_de?: string | null
        }
        Update: {
          aberto_em?: string | null
          acoes_pendentes?: Json | null
          afeta_reputacao?: string | null
          atualizado_em?: string
          claim_id?: number
          criado_em?: string
          detalhe?: Json | null
          enriquecido_em?: string | null
          fechado_em?: string | null
          id?: string
          lido_em?: string | null
          order_id?: number | null
          org_id?: string
          pedidos_devolucao?: Json | null
          prazo?: string | null
          rastreio?: string | null
          raw?: Json | null
          reason_id?: string | null
          reason_texto?: string | null
          return_id?: number | null
          return_status?: string | null
          return_status_money?: string | null
          revisao_pendente?: boolean
          revisao_status?: string | null
          stage?: string | null
          status?: string | null
          type?: string | null
          user_id?: string
          valor_em_jogo?: number | null
          vez_de?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_devolucoes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_formato_publicacao: {
        Row: {
          atualizado_em: string
          categoria_id: string
          connection_id: string
          criado_em: string
          formato: string
        }
        Insert: {
          atualizado_em?: string
          categoria_id: string
          connection_id: string
          criado_em?: string
          formato: string
        }
        Update: {
          atualizado_em?: string
          categoria_id?: string
          connection_id?: string
          criado_em?: string
          formato?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_formato_publicacao_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "marketplace_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_item_preco_dia: {
        Row: {
          dia: string
          ml_item_id: string
          moeda: string
          observado_em: string
          org_id: string
          origem: string
          preco: number
          preco_regular: number | null
        }
        Insert: {
          dia: string
          ml_item_id: string
          moeda: string
          observado_em: string
          org_id: string
          origem: string
          preco: number
          preco_regular?: number | null
        }
        Update: {
          dia?: string
          ml_item_id?: string
          moeda?: string
          observado_em?: string
          org_id?: string
          origem?: string
          preco?: number
          preco_regular?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_item_preco_dia_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_item_visitas_dia: {
        Row: {
          coletado_em: string
          dia: string
          estado: string
          ml_item_id: string
          org_id: string
          rodada: string
          visitas: number | null
        }
        Insert: {
          coletado_em: string
          dia: string
          estado: string
          ml_item_id: string
          org_id: string
          rodada: string
          visitas?: number | null
        }
        Update: {
          coletado_em?: string
          dia?: string
          estado?: string
          ml_item_id?: string
          org_id?: string
          rodada?: string
          visitas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_item_visitas_dia_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_mensagens: {
        Row: {
          atualizado_em: string
          comprador_nick: string | null
          comprador_nome: string | null
          data_ml: string | null
          direcao: string
          id: string
          item_id: string | null
          item_titulo: string | null
          lida: boolean
          lida_ml_em: string | null
          message_id: string
          order_id: string | null
          order_status: string | null
          org_id: string
          pack_id: string
          raw: Json | null
          texto: string
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          comprador_nick?: string | null
          comprador_nome?: string | null
          data_ml?: string | null
          direcao: string
          id?: string
          item_id?: string | null
          item_titulo?: string | null
          lida?: boolean
          lida_ml_em?: string | null
          message_id: string
          order_id?: string | null
          order_status?: string | null
          org_id: string
          pack_id: string
          raw?: Json | null
          texto?: string
          user_id: string
        }
        Update: {
          atualizado_em?: string
          comprador_nick?: string | null
          comprador_nome?: string | null
          data_ml?: string | null
          direcao?: string
          id?: string
          item_id?: string | null
          item_titulo?: string | null
          lida?: boolean
          lida_ml_em?: string | null
          message_id?: string
          order_id?: string | null
          order_status?: string | null
          org_id?: string
          pack_id?: string
          raw?: Json | null
          texto?: string
          user_id?: string
        }
        Relationships: []
      }
      ml_moderacao: {
        Row: {
          alertado_em: string | null
          atualizado_em: string
          detectado_em: string
          id: string
          ml_item_id: string
          motivo: string | null
          org_id: string
          resolvido_em: string | null
          status: string
          user_id: string
        }
        Insert: {
          alertado_em?: string | null
          atualizado_em?: string
          detectado_em?: string
          id?: string
          ml_item_id: string
          motivo?: string | null
          org_id: string
          resolvido_em?: string | null
          status: string
          user_id: string
        }
        Update: {
          alertado_em?: string | null
          atualizado_em?: string
          detectado_em?: string
          id?: string
          ml_item_id?: string
          motivo?: string | null
          org_id?: string
          resolvido_em?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_moderacao_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_notificacoes_enviadas: {
        Row: {
          chave: string
          entidade: string
          enviado_em: string
          org_id: string
          user_id: string | null
        }
        Insert: {
          chave: string
          entidade: string
          enviado_em?: string
          org_id: string
          user_id?: string | null
        }
        Update: {
          chave?: string
          entidade?: string
          enviado_em?: string
          org_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_notificacoes_enviadas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_perguntas: {
        Row: {
          atualizado_em: string
          comprador_id: number | null
          comprador_nick: string | null
          criada_em: string | null
          id: string
          item_id: string | null
          item_titulo: string | null
          org_id: string
          question_id: number
          raw: Json | null
          respondida_em: string | null
          resposta: string | null
          status: string
          texto: string
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          comprador_id?: number | null
          comprador_nick?: string | null
          criada_em?: string | null
          id?: string
          item_id?: string | null
          item_titulo?: string | null
          org_id: string
          question_id: number
          raw?: Json | null
          respondida_em?: string | null
          resposta?: string | null
          status: string
          texto?: string
          user_id: string
        }
        Update: {
          atualizado_em?: string
          comprador_id?: number | null
          comprador_nick?: string | null
          criada_em?: string | null
          id?: string
          item_id?: string | null
          item_titulo?: string | null
          org_id?: string
          question_id?: number
          raw?: Json | null
          respondida_em?: string | null
          resposta?: string | null
          status?: string
          texto?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_perguntas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_posvenda_acoes: {
        Row: {
          acao: string
          antes: Json | null
          atualizado_em: string
          claim_id: number
          criado_em: string
          erro: string | null
          estado: string
          http_status: number | null
          id: string
          operacao_id: string
          org_id: string
          payload: Json
          payload_hash: string
          post_em: string | null
          recurso: string
          resposta_ml: Json | null
          return_id: number | null
          sync_pendente: boolean
          user_id: string
        }
        Insert: {
          acao: string
          antes?: Json | null
          atualizado_em?: string
          claim_id: number
          criado_em?: string
          erro?: string | null
          estado: string
          http_status?: number | null
          id?: string
          operacao_id: string
          org_id: string
          payload: Json
          payload_hash: string
          post_em?: string | null
          recurso: string
          resposta_ml?: Json | null
          return_id?: number | null
          sync_pendente?: boolean
          user_id: string
        }
        Update: {
          acao?: string
          antes?: Json | null
          atualizado_em?: string
          claim_id?: number
          criado_em?: string
          erro?: string | null
          estado?: string
          http_status?: number | null
          id?: string
          operacao_id?: string
          org_id?: string
          payload?: Json
          payload_hash?: string
          post_em?: string | null
          recurso?: string
          resposta_ml?: Json | null
          return_id?: number | null
          sync_pendente?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_posvenda_acoes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_promocao_itens: {
        Row: {
          anuncio_normal_id: string | null
          estoque_max: number | null
          estoque_min: number | null
          listing_type_id: string | null
          ml_item_id: string
          ml_pct: number | null
          org_id: string
          permalink: string | null
          pior_semaforo: string
          preco_avaliado: number | null
          preco_max: number | null
          preco_min: number | null
          preco_original: number | null
          preco_promo: number | null
          preco_sugerido: number | null
          projecao: Json
          promocao_id: string
          sincronizado_em: string
          status: string
          thumbnail: string | null
          titulo: string | null
          vendedor_pct: number | null
        }
        Insert: {
          anuncio_normal_id?: string | null
          estoque_max?: number | null
          estoque_min?: number | null
          listing_type_id?: string | null
          ml_item_id: string
          ml_pct?: number | null
          org_id: string
          permalink?: string | null
          pior_semaforo: string
          preco_avaliado?: number | null
          preco_max?: number | null
          preco_min?: number | null
          preco_original?: number | null
          preco_promo?: number | null
          preco_sugerido?: number | null
          projecao?: Json
          promocao_id: string
          sincronizado_em?: string
          status: string
          thumbnail?: string | null
          titulo?: string | null
          vendedor_pct?: number | null
        }
        Update: {
          anuncio_normal_id?: string | null
          estoque_max?: number | null
          estoque_min?: number | null
          listing_type_id?: string | null
          ml_item_id?: string
          ml_pct?: number | null
          org_id?: string
          permalink?: string | null
          pior_semaforo?: string
          preco_avaliado?: number | null
          preco_max?: number | null
          preco_min?: number | null
          preco_original?: number | null
          preco_promo?: number | null
          preco_sugerido?: number | null
          projecao?: Json
          promocao_id?: string
          sincronizado_em?: string
          status?: string
          thumbnail?: string | null
          titulo?: string | null
          vendedor_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_promocao_itens_org_id_promocao_id_fkey"
            columns: ["org_id", "promocao_id"]
            isOneToOne: false
            referencedRelation: "ml_promocoes"
            referencedColumns: ["org_id", "promocao_id"]
          },
        ]
      }
      ml_promocoes: {
        Row: {
          beneficios: Json | null
          bruto: Json
          contagem: Json | null
          erro: string | null
          fim: string | null
          inicio: string | null
          itens_sincronizados_em: string | null
          nome: string | null
          org_id: string
          prazo_adesao: string | null
          promocao_id: string
          rodada_em_curso: string | null
          sincronizado_em: string
          status: string
          tipo: string
        }
        Insert: {
          beneficios?: Json | null
          bruto?: Json
          contagem?: Json | null
          erro?: string | null
          fim?: string | null
          inicio?: string | null
          itens_sincronizados_em?: string | null
          nome?: string | null
          org_id: string
          prazo_adesao?: string | null
          promocao_id: string
          rodada_em_curso?: string | null
          sincronizado_em?: string
          status: string
          tipo: string
        }
        Update: {
          beneficios?: Json | null
          bruto?: Json
          contagem?: Json | null
          erro?: string | null
          fim?: string | null
          inicio?: string | null
          itens_sincronizados_em?: string | null
          nome?: string | null
          org_id?: string
          prazo_adesao?: string | null
          promocao_id?: string
          rodada_em_curso?: string | null
          sincronizado_em?: string
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_promocoes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_promocoes_sync: {
        Row: {
          erro: string | null
          estado: string
          iniciado_em: string | null
          org_id: string
          ultimo_erro_em: string | null
          ultimo_ok_em: string | null
        }
        Insert: {
          erro?: string | null
          estado: string
          iniciado_em?: string | null
          org_id: string
          ultimo_erro_em?: string | null
          ultimo_ok_em?: string | null
        }
        Update: {
          erro?: string | null
          estado?: string
          iniciado_em?: string | null
          org_id?: string
          ultimo_erro_em?: string | null
          ultimo_ok_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_promocoes_sync_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_size_charts: {
        Row: {
          chart_id: string
          connection_id: string
          criado_em: string
          domain_id: string
          genero: string
          grade_tamanho: string
          linhas: Json
        }
        Insert: {
          chart_id: string
          connection_id: string
          criado_em?: string
          domain_id: string
          genero: string
          grade_tamanho: string
          linhas: Json
        }
        Update: {
          chart_id?: string
          connection_id?: string
          criado_em?: string
          domain_id?: string
          genero?: string
          grade_tamanho?: string
          linhas?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ml_size_charts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "marketplace_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_trafego_item: {
        Row: {
          ml_item_id: string
          org_id: string
          permalink: string | null
          status: string
          status_desde: string
          titulo: string | null
          ultimo_ok_em: string | null
          variacao: string | null
        }
        Insert: {
          ml_item_id: string
          org_id: string
          permalink?: string | null
          status: string
          status_desde: string
          titulo?: string | null
          ultimo_ok_em?: string | null
          variacao?: string | null
        }
        Update: {
          ml_item_id?: string
          org_id?: string
          permalink?: string | null
          status?: string
          status_desde?: string
          titulo?: string | null
          ultimo_ok_em?: string | null
          variacao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_trafego_item_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_trafego_sync: {
        Row: {
          carga_inicial_concluida_em: string | null
          cursor: string | null
          erro: string | null
          estado: string
          iniciado_em: string | null
          org_id: string
          posse_ate: string | null
          rodada: string | null
          ultimo_erro_em: string | null
          ultimo_ok_em: string | null
        }
        Insert: {
          carga_inicial_concluida_em?: string | null
          cursor?: string | null
          erro?: string | null
          estado: string
          iniciado_em?: string | null
          org_id: string
          posse_ate?: string | null
          rodada?: string | null
          ultimo_erro_em?: string | null
          ultimo_ok_em?: string | null
        }
        Update: {
          carga_inicial_concluida_em?: string | null
          cursor?: string | null
          erro?: string | null
          estado?: string
          iniciado_em?: string | null
          org_id?: string
          posse_ate?: string | null
          rodada?: string | null
          ultimo_erro_em?: string | null
          ultimo_ok_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_trafego_sync_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_vendas: {
        Row: {
          atualizado_em: string
          canal: string
          cidade: string | null
          comprador_id: number | null
          comprador_nick: string | null
          comprador_nome: string | null
          criado_em: string
          cupom_vendedor: number | null
          currency: string
          date_closed: string | null
          date_created: string | null
          estorno: number | null
          frete_vendedor: number | null
          id: string
          is_publiai: boolean
          kit_item_id: string | null
          liberacao_notificada_em: string | null
          liquido: number | null
          money_release_date: string | null
          order_id: number
          org_id: string
          pack_id: number | null
          paid_amount: number | null
          raw: Json | null
          sacado_em: string | null
          sacado_por: string | null
          sale_fee_total: number
          shipping_id: number | null
          shipping_logistic: string | null
          shipping_status: string | null
          shipping_substatus: string | null
          status: string
          status_detail: string | null
          tem_devolucao: boolean
          total_amount: number
          tracking_number: string | null
          uf: string | null
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          canal?: string
          cidade?: string | null
          comprador_id?: number | null
          comprador_nick?: string | null
          comprador_nome?: string | null
          criado_em?: string
          cupom_vendedor?: number | null
          currency?: string
          date_closed?: string | null
          date_created?: string | null
          estorno?: number | null
          frete_vendedor?: number | null
          id?: string
          is_publiai?: boolean
          kit_item_id?: string | null
          liberacao_notificada_em?: string | null
          liquido?: number | null
          money_release_date?: string | null
          order_id: number
          org_id: string
          pack_id?: number | null
          paid_amount?: number | null
          raw?: Json | null
          sacado_em?: string | null
          sacado_por?: string | null
          sale_fee_total?: number
          shipping_id?: number | null
          shipping_logistic?: string | null
          shipping_status?: string | null
          shipping_substatus?: string | null
          status: string
          status_detail?: string | null
          tem_devolucao?: boolean
          total_amount?: number
          tracking_number?: string | null
          uf?: string | null
          user_id: string
        }
        Update: {
          atualizado_em?: string
          canal?: string
          cidade?: string | null
          comprador_id?: number | null
          comprador_nick?: string | null
          comprador_nome?: string | null
          criado_em?: string
          cupom_vendedor?: number | null
          currency?: string
          date_closed?: string | null
          date_created?: string | null
          estorno?: number | null
          frete_vendedor?: number | null
          id?: string
          is_publiai?: boolean
          kit_item_id?: string | null
          liberacao_notificada_em?: string | null
          liquido?: number | null
          money_release_date?: string | null
          order_id?: number
          org_id?: string
          pack_id?: number | null
          paid_amount?: number | null
          raw?: Json | null
          sacado_em?: string | null
          sacado_por?: string | null
          sale_fee_total?: number
          shipping_id?: number | null
          shipping_logistic?: string | null
          shipping_status?: string | null
          shipping_substatus?: string | null
          status?: string
          status_detail?: string | null
          tem_devolucao?: boolean
          total_amount?: number
          tracking_number?: string | null
          uf?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_vendas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_vendas_sacado_por_fkey"
            columns: ["sacado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_vendas_itens: {
        Row: {
          codigo: string | null
          cor: string | null
          cupom_vendedor: number
          ean: string | null
          id: string
          is_publiai: boolean
          ml_item_id: string | null
          org_id: string
          quantity: number
          sale_fee: number
          titulo: string | null
          unit_price: number
          user_id: string
          variation_id: number | null
          venda_id: string
        }
        Insert: {
          codigo?: string | null
          cor?: string | null
          cupom_vendedor?: number
          ean?: string | null
          id?: string
          is_publiai?: boolean
          ml_item_id?: string | null
          org_id: string
          quantity?: number
          sale_fee?: number
          titulo?: string | null
          unit_price?: number
          user_id: string
          variation_id?: number | null
          venda_id: string
        }
        Update: {
          codigo?: string | null
          cor?: string | null
          cupom_vendedor?: number
          ean?: string | null
          id?: string
          is_publiai?: boolean
          ml_item_id?: string | null
          org_id?: string
          quantity?: number
          sale_fee?: number
          titulo?: string | null
          unit_price?: number
          user_id?: string
          variation_id?: number | null
          venda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_vendas_itens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_vendas_itens_venda_id_fkey"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "ml_vendas"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_webhook_eventos: {
        Row: {
          erro: string | null
          id: string
          org_id: string | null
          processado_em: string | null
          recebido_em: string
          resource: string
          topic: string
          user_id: string | null
        }
        Insert: {
          erro?: string | null
          id?: string
          org_id?: string | null
          processado_em?: string | null
          recebido_em?: string
          resource: string
          topic: string
          user_id?: string | null
        }
        Update: {
          erro?: string | null
          id?: string
          org_id?: string | null
          processado_em?: string | null
          recebido_em?: string
          resource?: string
          topic?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_webhook_eventos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ncm_oficial: {
        Row: {
          atualizado_em: string
          codigo: string
          data_fim: string
          data_inicio: string
          descricao: string
        }
        Insert: {
          atualizado_em?: string
          codigo: string
          data_fim: string
          data_inicio: string
          descricao: string
        }
        Update: {
          atualizado_em?: string
          codigo?: string
          data_fim?: string
          data_inicio?: string
          descricao?: string
        }
        Relationships: []
      }
      notas_compra: {
        Row: {
          assinada: boolean
          chave: string
          desfeita_em: string | null
          desfeita_por: string | null
          divergencia_total_aceita: number | null
          emitente_cnpj: string
          emitente_nome: string
          emitida_em: string
          id: string
          importada_em: string
          importada_por: string | null
          numero: number
          org_id: string
          serie: number
          status: string
          valor_total: number
          xml_path: string
          xml_sha256: string | null
        }
        Insert: {
          assinada: boolean
          chave: string
          desfeita_em?: string | null
          desfeita_por?: string | null
          divergencia_total_aceita?: number | null
          emitente_cnpj: string
          emitente_nome: string
          emitida_em: string
          id?: string
          importada_em?: string
          importada_por?: string | null
          numero: number
          org_id: string
          serie: number
          status?: string
          valor_total: number
          xml_path: string
          xml_sha256?: string | null
        }
        Update: {
          assinada?: boolean
          chave?: string
          desfeita_em?: string | null
          desfeita_por?: string | null
          divergencia_total_aceita?: number | null
          emitente_cnpj?: string
          emitente_nome?: string
          emitida_em?: string
          id?: string
          importada_em?: string
          importada_por?: string | null
          numero?: number
          org_id?: string
          serie?: number
          status?: string
          valor_total?: number
          xml_path?: string
          xml_sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notas_compra_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notas_compra_distribuicao: {
        Row: {
          codigo: string
          custo_aquisicao_unit: number
          custo_precificacao_unit: number
          id: string
          item_id: string
          org_id: string
          quantidade: number
        }
        Insert: {
          codigo: string
          custo_aquisicao_unit: number
          custo_precificacao_unit: number
          id?: string
          item_id: string
          org_id: string
          quantidade: number
        }
        Update: {
          codigo?: string
          custo_aquisicao_unit?: number
          custo_precificacao_unit?: number
          id?: string
          item_id?: string
          org_id?: string
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "notas_compra_distribuicao_item_org_fkey"
            columns: ["item_id", "org_id"]
            isOneToOne: false
            referencedRelation: "notas_compra_itens"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "notas_compra_distribuicao_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notas_compra_itens: {
        Row: {
          cfop: string
          codigo_pai: string
          cprod: string
          fator_conversao: number
          gtin: string | null
          id: string
          n_item: number
          ncm: string | null
          nota_id: string
          org_id: string
          orig: number | null
          qcom: number
          rateio: Json
          ucom: string
          v_desc: number
          v_fcpst: number
          v_frete: number
          v_ipi: number
          v_outro: number
          v_prod: number
          v_seg: number
          v_st: number
          xprod: string
        }
        Insert: {
          cfop: string
          codigo_pai: string
          cprod: string
          fator_conversao?: number
          gtin?: string | null
          id?: string
          n_item: number
          ncm?: string | null
          nota_id: string
          org_id: string
          orig?: number | null
          qcom: number
          rateio?: Json
          ucom: string
          v_desc?: number
          v_fcpst?: number
          v_frete?: number
          v_ipi?: number
          v_outro?: number
          v_prod: number
          v_seg?: number
          v_st?: number
          xprod: string
        }
        Update: {
          cfop?: string
          codigo_pai?: string
          cprod?: string
          fator_conversao?: number
          gtin?: string | null
          id?: string
          n_item?: number
          ncm?: string | null
          nota_id?: string
          org_id?: string
          orig?: number | null
          qcom?: number
          rateio?: Json
          ucom?: string
          v_desc?: number
          v_fcpst?: number
          v_frete?: number
          v_ipi?: number
          v_outro?: number
          v_prod?: number
          v_seg?: number
          v_st?: number
          xprod?: string
        }
        Relationships: [
          {
            foreignKeyName: "notas_compra_itens_nota_org_fkey"
            columns: ["nota_id", "org_id"]
            isOneToOne: false
            referencedRelation: "notas_compra"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "notas_compra_itens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacao_carrinho: {
        Row: {
          atualizado_em: string
          chave: string
          esperadas: number[] | null
          order_id: number
          org_id: string
          pack_id: number | null
          primeiro_em: string
          status: string
          tentativas: number
        }
        Insert: {
          atualizado_em?: string
          chave: string
          esperadas?: number[] | null
          order_id: number
          org_id: string
          pack_id?: number | null
          primeiro_em?: string
          status?: string
          tentativas?: number
        }
        Update: {
          atualizado_em?: string
          chave?: string
          esperadas?: number[] | null
          order_id?: number
          org_id?: string
          pack_id?: number | null
          primeiro_em?: string
          status?: string
          tentativas?: number
        }
        Relationships: [
          {
            foreignKeyName: "notificacao_carrinho_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          categoria: string
          chave: string | null
          criada_em: string
          id: string
          lida: boolean
          org_id: string
          texto: string
          user_id: string
        }
        Insert: {
          categoria: string
          chave?: string | null
          criada_em?: string
          id?: string
          lida?: boolean
          org_id: string
          texto: string
          user_id: string
        }
        Update: {
          categoria?: string
          chave?: string | null
          criada_em?: string
          id?: string
          lida?: boolean
          org_id?: string
          texto?: string
          user_id?: string
        }
        Relationships: []
      }
      operacoes_massa: {
        Row: {
          acao: string
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          expira_em: string | null
          id: string
          org_id: string
          origem_id: string | null
          promocao_id: string | null
          promocao_nome: string | null
          promocao_tipo: string | null
          status: string
        }
        Insert: {
          acao: string
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          expira_em?: string | null
          id?: string
          org_id: string
          origem_id?: string | null
          promocao_id?: string | null
          promocao_nome?: string | null
          promocao_tipo?: string | null
          status?: string
        }
        Update: {
          acao?: string
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          expira_em?: string | null
          id?: string
          org_id?: string
          origem_id?: string | null
          promocao_id?: string | null
          promocao_nome?: string | null
          promocao_tipo?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "operacoes_massa_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operacoes_massa_origem_id_fkey"
            columns: ["origem_id"]
            isOneToOne: false
            referencedRelation: "operacoes_massa"
            referencedColumns: ["id"]
          },
        ]
      }
      operacoes_massa_itens: {
        Row: {
          atualizado_em: string
          avaliacao: Json | null
          codigo_pai: string | null
          conferencias: number
          confirmado_risco: boolean
          confirmado_sem_dado: boolean
          estado_anterior: Json | null
          etapa: string | null
          incluido: boolean
          mensagem: string | null
          ml_item_id: string
          offer_id: string | null
          operacao_id: string
          org_id: string
          preco: number | null
          preco_anterior: number | null
          promocao_id: string | null
          proxima_conferencia: string | null
          saida_pedida_em: string | null
          semaforo: string | null
          status: string
          titulo: string | null
          variacao_ids: string[] | null
          variacoes_ml: Json | null
        }
        Insert: {
          atualizado_em?: string
          avaliacao?: Json | null
          codigo_pai?: string | null
          conferencias?: number
          confirmado_risco?: boolean
          confirmado_sem_dado?: boolean
          estado_anterior?: Json | null
          etapa?: string | null
          incluido?: boolean
          mensagem?: string | null
          ml_item_id: string
          offer_id?: string | null
          operacao_id: string
          org_id: string
          preco?: number | null
          preco_anterior?: number | null
          promocao_id?: string | null
          proxima_conferencia?: string | null
          saida_pedida_em?: string | null
          semaforo?: string | null
          status?: string
          titulo?: string | null
          variacao_ids?: string[] | null
          variacoes_ml?: Json | null
        }
        Update: {
          atualizado_em?: string
          avaliacao?: Json | null
          codigo_pai?: string | null
          conferencias?: number
          confirmado_risco?: boolean
          confirmado_sem_dado?: boolean
          estado_anterior?: Json | null
          etapa?: string | null
          incluido?: boolean
          mensagem?: string | null
          ml_item_id?: string
          offer_id?: string | null
          operacao_id?: string
          org_id?: string
          preco?: number | null
          preco_anterior?: number | null
          promocao_id?: string | null
          proxima_conferencia?: string | null
          saida_pedida_em?: string | null
          semaforo?: string | null
          status?: string
          titulo?: string | null
          variacao_ids?: string[] | null
          variacoes_ml?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "operacoes_massa_itens_operacao_id_fkey"
            columns: ["operacao_id"]
            isOneToOne: false
            referencedRelation: "operacoes_massa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operacoes_massa_itens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          arquivada_em: string | null
          atualizado_em: string
          canais_habilitados: string[]
          criado_em: string
          id: string
          is_test: boolean
          lote_seq: number
          marca_padrao: string | null
          marca_propria: boolean
          modulos_habilitados: string[]
          nome: string
          produto_seq: number
          slug: string
          tipo_pessoa: string
          tipos_produto_habilitados: string[]
        }
        Insert: {
          arquivada_em?: string | null
          atualizado_em?: string
          canais_habilitados?: string[]
          criado_em?: string
          id?: string
          is_test?: boolean
          lote_seq?: number
          marca_padrao?: string | null
          marca_propria?: boolean
          modulos_habilitados?: string[]
          nome: string
          produto_seq?: number
          slug: string
          tipo_pessoa?: string
          tipos_produto_habilitados?: string[]
        }
        Update: {
          arquivada_em?: string | null
          atualizado_em?: string
          canais_habilitados?: string[]
          criado_em?: string
          id?: string
          is_test?: boolean
          lote_seq?: number
          marca_padrao?: string | null
          marca_propria?: boolean
          modulos_habilitados?: string[]
          nome?: string
          produto_seq?: number
          slug?: string
          tipo_pessoa?: string
          tipos_produto_habilitados?: string[]
        }
        Relationships: []
      }
      platform_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          category: string
          details: Json
          id: string
          occurred_at: string
          org_id: string
          reason: string | null
          result: string
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          category: string
          details?: Json
          id?: string
          occurred_at?: string
          org_id: string
          reason?: string | null
          result: string
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          category?: string
          details?: Json
          id?: string
          occurred_at?: string
          org_id?: string
          reason?: string | null
          result?: string
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_billing_sale_facts: {
        Row: {
          gross_cents: number
          id: string
          org_id: string
          recognized_base_cents: number
          refunded_product_cents: number
          sale_id: string
          source_updated_at: string
          statement_id: string
          status: string
        }
        Insert: {
          gross_cents: number
          id?: string
          org_id: string
          recognized_base_cents: number
          refunded_product_cents: number
          sale_id: string
          source_updated_at: string
          statement_id: string
          status: string
        }
        Update: {
          gross_cents?: number
          id?: string
          org_id?: string
          recognized_base_cents?: number
          refunded_product_cents?: number
          sale_id?: string
          source_updated_at?: string
          statement_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_billing_sale_facts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_billing_sale_facts_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "platform_billing_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_billing_statements: {
        Row: {
          base_cents: number
          closed_at: string
          closed_by: string
          credit_cents: number
          fee_cents: number
          gross_cents: number
          id: string
          month: string
          org_id: string
          refund_cents: number
          revenue_bps: number
          revision: string
          snapshot: Json
          sonar_cents: number
          terms_id: string
          total_cents: number
        }
        Insert: {
          base_cents: number
          closed_at?: string
          closed_by: string
          credit_cents: number
          fee_cents: number
          gross_cents: number
          id?: string
          month: string
          org_id: string
          refund_cents: number
          revenue_bps: number
          revision: string
          snapshot: Json
          sonar_cents: number
          terms_id: string
          total_cents: number
        }
        Update: {
          base_cents?: number
          closed_at?: string
          closed_by?: string
          credit_cents?: number
          fee_cents?: number
          gross_cents?: number
          id?: string
          month?: string
          org_id?: string
          refund_cents?: number
          revenue_bps?: number
          revision?: string
          snapshot?: Json
          sonar_cents?: number
          terms_id?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_billing_statements_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_billing_statements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_billing_statements_terms_id_fkey"
            columns: ["terms_id"]
            isOneToOne: false
            referencedRelation: "platform_commercial_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_commercial_terms: {
        Row: {
          created_at: string
          created_by: string
          id: string
          modality: number
          monthly_fee_cents: number
          org_id: string
          reason: string
          revenue_bps_t1: number
          revenue_bps_t2: number
          revenue_bps_t3: number
          revenue_bps_t4: number
          setup_due_month: string | null
          setup_fee_cents: number
          sonar_unit_cents: number
          starts_on: string
          timezone: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          modality: number
          monthly_fee_cents: number
          org_id: string
          reason: string
          revenue_bps_t1: number
          revenue_bps_t2: number
          revenue_bps_t3: number
          revenue_bps_t4: number
          setup_due_month?: string | null
          setup_fee_cents: number
          sonar_unit_cents: number
          starts_on: string
          timezone?: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          modality?: number
          monthly_fee_cents?: number
          org_id?: string
          reason?: string
          revenue_bps_t1?: number
          revenue_bps_t2?: number
          revenue_bps_t3?: number
          revenue_bps_t4?: number
          setup_due_month?: string | null
          setup_fee_cents?: number
          sonar_unit_cents?: number
          starts_on?: string
          timezone?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_commercial_terms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_org_month_metrics: {
        Row: {
          computed_at: string
          cost_covered_orders: number
          gross_cents: number
          markup: number | null
          month: string
          orders: number
          org_id: string
          source_count: number
          source_max_updated_at: string | null
          tax_config_stamp: string
          ticket_cents: number
          total_orders: number
          updated_at: string | null
        }
        Insert: {
          computed_at?: string
          cost_covered_orders: number
          gross_cents: number
          markup?: number | null
          month: string
          orders: number
          org_id: string
          source_count: number
          source_max_updated_at?: string | null
          tax_config_stamp: string
          ticket_cents: number
          total_orders: number
          updated_at?: string | null
        }
        Update: {
          computed_at?: string
          cost_covered_orders?: number
          gross_cents?: number
          markup?: number | null
          month?: string
          orders?: number
          org_id?: string
          source_count?: number
          source_max_updated_at?: string | null
          tax_config_stamp?: string
          ticket_cents?: number
          total_orders?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_org_month_metrics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_revenue_reconciliations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          org_id: string
          reason: string
          refunded_product_cents: number
          sale_id: string
          source_gross_cents: number
          source_status: string
          source_updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          org_id: string
          reason: string
          refunded_product_cents: number
          sale_id: string
          source_gross_cents: number
          source_status: string
          source_updated_at: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          org_id?: string
          reason?: string
          refunded_product_cents?: number
          sale_id?: string
          source_gross_cents?: number
          source_status?: string
          source_updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_revenue_reconciliations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_revenue_reconciliations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_sonar_deliveries: {
        Row: {
          actor_id: string
          delivered_at: string
          id: string
          month: string
          org_id: string
          reason: string | null
          result_id: string
          search_id: string
          terms_id: string | null
          timezone: string
          total_cents: number
          unit_cents: number
          units: number
        }
        Insert: {
          actor_id: string
          delivered_at?: string
          id?: string
          month: string
          org_id: string
          reason?: string | null
          result_id: string
          search_id: string
          terms_id?: string | null
          timezone?: string
          total_cents: number
          unit_cents: number
          units: number
        }
        Update: {
          actor_id?: string
          delivered_at?: string
          id?: string
          month?: string
          org_id?: string
          reason?: string | null
          result_id?: string
          search_id?: string
          terms_id?: string | null
          timezone?: string
          total_cents?: number
          unit_cents?: number
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_sonar_deliveries_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_deliveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_deliveries_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "platform_sonar_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_deliveries_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "platform_sonar_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_deliveries_terms_id_fkey"
            columns: ["terms_id"]
            isOneToOne: false
            referencedRelation: "platform_commercial_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_sonar_events: {
        Row: {
          actor_id: string
          details: Json
          id: string
          occurred_at: string
          org_id: string
          outcome: string
          reason: string | null
          result_id: string | null
          search_id: string
          stage: string
        }
        Insert: {
          actor_id: string
          details?: Json
          id?: string
          occurred_at?: string
          org_id: string
          outcome: string
          reason?: string | null
          result_id?: string | null
          search_id: string
          stage: string
        }
        Update: {
          actor_id?: string
          details?: Json
          id?: string
          occurred_at?: string
          org_id?: string
          outcome?: string
          reason?: string | null
          result_id?: string | null
          search_id?: string
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_sonar_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_events_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "platform_sonar_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_events_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "platform_sonar_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_sonar_results: {
        Row: {
          created_at: string
          failure_reason: string | null
          generation: number
          id: string
          lease_token: string | null
          lease_until: string | null
          normalized_query: string
          payload: Json | null
          query_type: string
          schema_version: number
          state: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          generation: number
          id?: string
          lease_token?: string | null
          lease_until?: string | null
          normalized_query: string
          payload?: Json | null
          query_type: string
          schema_version: number
          state: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          generation?: number
          id?: string
          lease_token?: string | null
          lease_until?: string | null
          normalized_query?: string
          payload?: Json | null
          query_type?: string
          schema_version?: number
          state?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      platform_sonar_searches: {
        Row: {
          actor_id: string
          completed_at: string | null
          created_at: string
          id: string
          intent_key: string
          lease_token: string | null
          normalized_query: string
          org_id: string
          origin: string
          query_type: string
          request_id: string
          result_id: string | null
          state: string
          support_request_id: string | null
        }
        Insert: {
          actor_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          intent_key: string
          lease_token?: string | null
          normalized_query: string
          org_id: string
          origin: string
          query_type: string
          request_id: string
          result_id?: string | null
          state: string
          support_request_id?: string | null
        }
        Update: {
          actor_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          intent_key?: string
          lease_token?: string | null
          normalized_query?: string
          org_id?: string
          origin?: string
          query_type?: string
          request_id?: string
          result_id?: string | null
          state?: string
          support_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_sonar_searches_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_searches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_searches_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "platform_sonar_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_sonar_searches_support_request_id_fkey"
            columns: ["support_request_id"]
            isOneToOne: false
            referencedRelation: "support_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          allowed_menus: string[]
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_admin: boolean
          is_super_admin: boolean
          nome: string
          org_id: string | null
          telegram_categorias: string[]
          telegram_chat_id: string | null
          updated_at: string
        }
        Insert: {
          allowed_menus?: string[]
          created_at?: string
          email?: string | null
          id: string
          is_active?: boolean
          is_admin?: boolean
          is_super_admin?: boolean
          nome?: string
          org_id?: string | null
          telegram_categorias?: string[]
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed_menus?: string[]
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          is_super_admin?: boolean
          nome?: string
          org_id?: string | null
          telegram_categorias?: string[]
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_alertas: {
        Row: {
          criado_em: string
          dedupe_dia_utc: string | null
          dedupe_preco_caiu: string | null
          id: string
          lido: boolean
          org_id: string
          payload: Json
          produto_id: string | null
          severidade: string
          tipo: string
        }
        Insert: {
          criado_em?: string
          dedupe_dia_utc?: string | null
          dedupe_preco_caiu?: string | null
          id?: string
          lido?: boolean
          org_id: string
          payload?: Json
          produto_id?: string | null
          severidade?: string
          tipo: string
        }
        Update: {
          criado_em?: string
          dedupe_dia_utc?: string | null
          dedupe_preco_caiu?: string | null
          id?: string
          lido?: boolean
          org_id?: string
          payload?: Json
          produto_id?: string | null
          severidade?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulse_alertas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pulse_alertas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "pulse_produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_ofertas: {
        Row: {
          ativo: boolean
          criado_em: string
          dia: string
          frete_gratis: boolean
          full_ml: boolean
          id: string
          item_id: string
          loja_oficial: boolean
          org_id: string
          permalink: string | null
          preco: number
          produto_id: string
          seller_id: number
          tier: string | null
          visitas_30d: number | null
          visitas_30d_em: string | null
        }
        Insert: {
          ativo?: boolean
          criado_em?: string
          dia?: string
          frete_gratis?: boolean
          full_ml?: boolean
          id?: string
          item_id: string
          loja_oficial?: boolean
          org_id: string
          permalink?: string | null
          preco: number
          produto_id: string
          seller_id: number
          tier?: string | null
          visitas_30d?: number | null
          visitas_30d_em?: string | null
        }
        Update: {
          ativo?: boolean
          criado_em?: string
          dia?: string
          frete_gratis?: boolean
          full_ml?: boolean
          id?: string
          item_id?: string
          loja_oficial?: boolean
          org_id?: string
          permalink?: string | null
          preco?: number
          produto_id?: string
          seller_id?: number
          tier?: string | null
          visitas_30d?: number | null
          visitas_30d_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pulse_ofertas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pulse_ofertas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "pulse_produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_produtos: {
        Row: {
          anuncio_status: string | null
          anuncio_status_em: string | null
          anuncio_sub_status: string[] | null
          atualizado_em: string
          catalog_product_id: string
          catalogo_status: string | null
          codigo_pai: string | null
          coleta_falhas_seguidas: number
          coleta_tentativa_em: string | null
          comissao_em: string | null
          comissao_fixa: number | null
          comissao_pct: number | null
          comissao_preco: number | null
          criado_em: string
          gtin: string | null
          id: string
          meu_item_id: string | null
          meu_preco: number | null
          meu_preco_em: string | null
          org_id: string
          origem: string
          ptw_aplicavel: boolean | null
          ptw_atualizado_em: string | null
          ptw_custos: Json | null
          ptw_preco_sugerido: number | null
          ptw_status: string | null
          status: string
          titulo: string | null
          ultimo_snapshot_em: string | null
        }
        Insert: {
          anuncio_status?: string | null
          anuncio_status_em?: string | null
          anuncio_sub_status?: string[] | null
          atualizado_em?: string
          catalog_product_id: string
          catalogo_status?: string | null
          codigo_pai?: string | null
          coleta_falhas_seguidas?: number
          coleta_tentativa_em?: string | null
          comissao_em?: string | null
          comissao_fixa?: number | null
          comissao_pct?: number | null
          comissao_preco?: number | null
          criado_em?: string
          gtin?: string | null
          id?: string
          meu_item_id?: string | null
          meu_preco?: number | null
          meu_preco_em?: string | null
          org_id: string
          origem?: string
          ptw_aplicavel?: boolean | null
          ptw_atualizado_em?: string | null
          ptw_custos?: Json | null
          ptw_preco_sugerido?: number | null
          ptw_status?: string | null
          status?: string
          titulo?: string | null
          ultimo_snapshot_em?: string | null
        }
        Update: {
          anuncio_status?: string | null
          anuncio_status_em?: string | null
          anuncio_sub_status?: string[] | null
          atualizado_em?: string
          catalog_product_id?: string
          catalogo_status?: string | null
          codigo_pai?: string | null
          coleta_falhas_seguidas?: number
          coleta_tentativa_em?: string | null
          comissao_em?: string | null
          comissao_fixa?: number | null
          comissao_pct?: number | null
          comissao_preco?: number | null
          criado_em?: string
          gtin?: string | null
          id?: string
          meu_item_id?: string | null
          meu_preco?: number | null
          meu_preco_em?: string | null
          org_id?: string
          origem?: string
          ptw_aplicavel?: boolean | null
          ptw_atualizado_em?: string | null
          ptw_custos?: Json | null
          ptw_preco_sugerido?: number | null
          ptw_status?: string | null
          status?: string
          titulo?: string | null
          ultimo_snapshot_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pulse_produtos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_vendedores: {
        Row: {
          criado_em: string
          dia: string
          id: string
          nickname: string | null
          nivel: string | null
          org_id: string
          perfil_coletado_em: string | null
          power_seller: string | null
          reputacao_detalhe: Json | null
          seller_id: number
          transactions_total: number | null
          uf: string | null
        }
        Insert: {
          criado_em?: string
          dia?: string
          id?: string
          nickname?: string | null
          nivel?: string | null
          org_id: string
          perfil_coletado_em?: string | null
          power_seller?: string | null
          reputacao_detalhe?: Json | null
          seller_id: number
          transactions_total?: number | null
          uf?: string | null
        }
        Update: {
          criado_em?: string
          dia?: string
          id?: string
          nickname?: string | null
          nivel?: string | null
          org_id?: string
          perfil_coletado_em?: string | null
          power_seller?: string | null
          reputacao_detalhe?: Json | null
          seller_id?: number
          transactions_total?: number | null
          uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pulse_vendedores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sonar_snapshots: {
        Row: {
          catalog_product_id: string | null
          criado_em: string
          gerado_em: string
          id: string
          item_id: string
          patrocinado: boolean | null
          posicao: number | null
          preco: number | null
          termo: string
          titulo: string | null
          vendedor: string | null
          vendidos: number | null
        }
        Insert: {
          catalog_product_id?: string | null
          criado_em?: string
          gerado_em: string
          id?: string
          item_id: string
          patrocinado?: boolean | null
          posicao?: number | null
          preco?: number | null
          termo: string
          titulo?: string | null
          vendedor?: string | null
          vendidos?: number | null
        }
        Update: {
          catalog_product_id?: string | null
          criado_em?: string
          gerado_em?: string
          id?: string
          item_id?: string
          patrocinado?: boolean | null
          posicao?: number | null
          preco?: number | null
          termo?: string
          titulo?: string | null
          vendedor?: string | null
          vendidos?: number | null
        }
        Relationships: []
      }
      support_audit_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event: Database["public"]["Enums"]["support_audit_event"]
          id: string
          legal_hold: boolean
          org_id: string
          result: Database["public"]["Enums"]["support_audit_result"]
          support_request_id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event: Database["public"]["Enums"]["support_audit_event"]
          id?: string
          legal_hold?: boolean
          org_id: string
          result: Database["public"]["Enums"]["support_audit_result"]
          support_request_id: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event?: Database["public"]["Enums"]["support_audit_event"]
          id?: string
          legal_hold?: boolean
          org_id?: string
          result?: Database["public"]["Enums"]["support_audit_result"]
          support_request_id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_audit_events_request_org_fk"
            columns: ["support_request_id", "org_id"]
            isOneToOne: false
            referencedRelation: "support_requests"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      support_requests: {
        Row: {
          approval_expires_at: string | null
          approved_at: string | null
          cancelled_at: string | null
          created_at: string
          decided_by: string | null
          ended_at: string | null
          expired_at: string | null
          expires_at: string | null
          id: string
          org_id: string
          pending_expires_at: string
          reason: string
          rejected_at: string | null
          renewal_of: string | null
          requester_id: string
          revoked_at: string | null
          revoked_by: string | null
          scope: Database["public"]["Enums"]["support_scope"]
          started_at: string | null
          status: Database["public"]["Enums"]["support_status"]
          updated_at: string
        }
        Insert: {
          approval_expires_at?: string | null
          approved_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          decided_by?: string | null
          ended_at?: string | null
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          org_id: string
          pending_expires_at?: string
          reason: string
          rejected_at?: string | null
          renewal_of?: string | null
          requester_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          scope: Database["public"]["Enums"]["support_scope"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["support_status"]
          updated_at?: string
        }
        Update: {
          approval_expires_at?: string | null
          approved_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          decided_by?: string | null
          ended_at?: string | null
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          org_id?: string
          pending_expires_at?: string
          reason?: string
          rejected_at?: string | null
          renewal_of?: string | null
          requester_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: Database["public"]["Enums"]["support_scope"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["support_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_requests_renewal_of_fkey"
            columns: ["renewal_of"]
            isOneToOne: false
            referencedRelation: "support_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_requests_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_updates: {
        Row: {
          bot_id: number
          erro: string | null
          lease_ate: string | null
          lease_id: string | null
          org_id: string
          payload: Json
          processado_em: string | null
          publicado_em: string | null
          recebido_em: string
          status: string
          tentativas: number
          update_id: number
        }
        Insert: {
          bot_id: number
          erro?: string | null
          lease_ate?: string | null
          lease_id?: string | null
          org_id: string
          payload: Json
          processado_em?: string | null
          publicado_em?: string | null
          recebido_em?: string
          status?: string
          tentativas?: number
          update_id: number
        }
        Update: {
          bot_id?: number
          erro?: string | null
          lease_ate?: string | null
          lease_id?: string | null
          org_id?: string
          payload?: Json
          processado_em?: string | null
          publicado_em?: string | null
          recebido_em?: string
          status?: string
          tentativas?: number
          update_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "telegram_updates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      variacoes: {
        Row: {
          altura_cm: number | null
          atacado: Json | null
          atualizado_em: string
          catalog_erro: string | null
          catalog_listing_id: string | null
          catalog_product_id: string | null
          catalog_status: string
          codigo: string
          comprimento_cm: number | null
          cor: string | null
          cor_editada_pelo_operador: boolean
          cor_hex: string | null
          cor_origem: Database["public"]["Enums"]["cor_origem"] | null
          criado_em: string
          custo: number | null
          desconto_pct: number | null
          estoque: number
          estoque_anterior: number | null
          excluida_da_publicacao: boolean
          exibir_com_desconto: boolean | null
          familia_id: string
          gtin: string | null
          id: string
          imagem_path: string | null
          largura_cm: number | null
          ml_picture_id: string | null
          ml_variation_id: string | null
          nome: string | null
          org_id: string
          peso_gramas: number | null
          preco: number
          preco_editado_pelo_operador: boolean
          preco_publicacao: number | null
          preco_publicado_ml: number | null
          tamanho: string | null
          user_id: string
        }
        Insert: {
          altura_cm?: number | null
          atacado?: Json | null
          atualizado_em?: string
          catalog_erro?: string | null
          catalog_listing_id?: string | null
          catalog_product_id?: string | null
          catalog_status?: string
          codigo: string
          comprimento_cm?: number | null
          cor?: string | null
          cor_editada_pelo_operador?: boolean
          cor_hex?: string | null
          cor_origem?: Database["public"]["Enums"]["cor_origem"] | null
          criado_em?: string
          custo?: number | null
          desconto_pct?: number | null
          estoque?: number
          estoque_anterior?: number | null
          excluida_da_publicacao?: boolean
          exibir_com_desconto?: boolean | null
          familia_id: string
          gtin?: string | null
          id?: string
          imagem_path?: string | null
          largura_cm?: number | null
          ml_picture_id?: string | null
          ml_variation_id?: string | null
          nome?: string | null
          org_id: string
          peso_gramas?: number | null
          preco: number
          preco_editado_pelo_operador?: boolean
          preco_publicacao?: number | null
          preco_publicado_ml?: number | null
          tamanho?: string | null
          user_id: string
        }
        Update: {
          altura_cm?: number | null
          atacado?: Json | null
          atualizado_em?: string
          catalog_erro?: string | null
          catalog_listing_id?: string | null
          catalog_product_id?: string | null
          catalog_status?: string
          codigo?: string
          comprimento_cm?: number | null
          cor?: string | null
          cor_editada_pelo_operador?: boolean
          cor_hex?: string | null
          cor_origem?: Database["public"]["Enums"]["cor_origem"] | null
          criado_em?: string
          custo?: number | null
          desconto_pct?: number | null
          estoque?: number
          estoque_anterior?: number | null
          excluida_da_publicacao?: boolean
          exibir_com_desconto?: boolean | null
          familia_id?: string
          gtin?: string | null
          id?: string
          imagem_path?: string | null
          largura_cm?: number | null
          ml_picture_id?: string | null
          ml_variation_id?: string | null
          nome?: string | null
          org_id?: string
          peso_gramas?: number | null
          preco?: number
          preco_editado_pelo_operador?: boolean
          preco_publicacao?: number | null
          preco_publicado_ml?: number | null
          tamanho?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variacoes_familia_id_fkey"
            columns: ["familia_id"]
            isOneToOne: false
            referencedRelation: "familias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variacoes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      venda_item_custo: {
        Row: {
          codigo: string | null
          congelado_em: string
          custo_unitario: number
          fonte: string
          id: string
          ml_item_id: string | null
          org_id: string | null
          user_id: string
          variation_id: number | null
          venda_id: string
        }
        Insert: {
          codigo?: string | null
          congelado_em?: string
          custo_unitario: number
          fonte: string
          id?: string
          ml_item_id?: string | null
          org_id?: string | null
          user_id: string
          variation_id?: number | null
          venda_id: string
        }
        Update: {
          codigo?: string | null
          congelado_em?: string
          custo_unitario?: number
          fonte?: string
          id?: string
          ml_item_id?: string | null
          org_id?: string | null
          user_id?: string
          variation_id?: number | null
          venda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venda_item_custo_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venda_item_custo_venda_id_fkey"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "ml_vendas"
            referencedColumns: ["id"]
          },
        ]
      }
      vinculos_fornecedor: {
        Row: {
          atualizado_em: string
          cnpj_fornecedor: string
          codigo_pai: string
          cprod: string
          fator_conversao: number
          org_id: string
        }
        Insert: {
          atualizado_em?: string
          cnpj_fornecedor: string
          codigo_pai: string
          cprod: string
          fator_conversao?: number
          org_id: string
        }
        Update: {
          atualizado_em?: string
          cnpj_fornecedor?: string
          codigo_pai?: string
          cprod?: string
          fator_conversao?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vinculos_fornecedor_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_pendencias: {
        Row: {
          atualizado_em: string
          criado_em: string
          descartado_em: string | null
          order_id: string
          org_id: string
          tentativas: number
          ultimo_erro: string | null
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          descartado_em?: string | null
          order_id: string
          org_id: string
          tentativas?: number
          ultimo_erro?: string | null
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          descartado_em?: string | null
          order_id?: string
          org_id?: string
          tentativas?: number
          ultimo_erro?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_pendencias_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_rodadas: {
        Row: {
          acumulado: Json
          ciclo: string
          cursor: string | null
          erro: string | null
          estado: string
          iniciado_em: string
          job: string
          lease_ate: string | null
          lease_id: string | null
          notificar_pendente: boolean
          org_id: string
          params: Json
          ultimo_erro_em: string | null
          ultimo_ok_em: string | null
        }
        Insert: {
          acumulado?: Json
          ciclo: string
          cursor?: string | null
          erro?: string | null
          estado: string
          iniciado_em: string
          job: string
          lease_ate?: string | null
          lease_id?: string | null
          notificar_pendente?: boolean
          org_id: string
          params?: Json
          ultimo_erro_em?: string | null
          ultimo_ok_em?: string | null
        }
        Update: {
          acumulado?: Json
          ciclo?: string
          cursor?: string | null
          erro?: string | null
          estado?: string
          iniciado_em?: string
          job?: string
          lease_ate?: string | null
          lease_id?: string | null
          notificar_pendente?: boolean
          org_id?: string
          params?: Json
          ultimo_erro_em?: string | null
          ultimo_ok_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_rodadas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      pulse_ofertas_atual: {
        Row: {
          ativo: boolean | null
          dia: string | null
          frete_gratis: boolean | null
          full_ml: boolean | null
          id: string | null
          item_id: string | null
          loja_oficial: boolean | null
          org_id: string | null
          permalink: string | null
          preco: number | null
          produto_id: string | null
          seller_id: number | null
          tier: string | null
          visitas_30d: number | null
          visitas_30d_em: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pulse_ofertas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pulse_ofertas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "pulse_produtos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abrir_execucao: {
        Args: { p_ciclo: string; p_job: string; p_org: string; p_params: Json }
        Returns: {
          acumulado: Json
          ciclo: string
          cursor: string
          estado: string
          lease: string
          notificar_pendente: boolean
          params: Json
          resultado: string
        }[]
      }
      adotar_familia_migrada_up: {
        Args: {
          p_codigo_pai: string
          p_familia_id: string
          p_family_name: string
          p_filhos: Json
          p_ml_item_id: string
          p_ml_item_id_antigo: string
          p_org_id: string
          p_user_id: string
        }
        Returns: string
      }
      adquirir_lease_marca: {
        Args: { p_raiz: string; p_ttl_s: number }
        Returns: boolean
      }
      ads_painel: { Args: { p_ate: string; p_desde: string }; Returns: Json }
      ads_resumo_periodo: {
        Args: { p_ate: string; p_desde: string }
        Returns: Json
      }
      ajustar_estoque: {
        Args: {
          p_codigo: string
          p_criado_por: string
          p_novo_saldo: number
          p_obs: string
          p_org: string
          p_ref: string
        }
        Returns: number
      }
      arquivar_organizacao: { Args: { p_org_id: string }; Returns: string }
      atributos_com_marca: {
        Args: { p_attrs: Json; p_marca: string }
        Returns: Json
      }
      avancar_ads_cursor: {
        Args: {
          p_cursor_atual: string
          p_cursor_novo: string
          p_org: string
          p_rodada: string
        }
        Returns: boolean
      }
      avancar_execucao: {
        Args: {
          p_acumulado: Json
          p_cursor_novo: string
          p_job: string
          p_lease: string
          p_org: string
        }
        Returns: boolean
      }
      avancar_trafego_cursor: {
        Args: {
          p_cursor_atual: string
          p_cursor_novo: string
          p_org: string
          p_rodada: string
        }
        Returns: boolean
      }
      baixar_estoque: {
        Args: {
          p_canal: string
          p_codigo: string
          p_org: string
          p_qtd: number
          p_ref: string
        }
        Returns: Json
      }
      can_write_current_org: { Args: never; Returns: boolean }
      canais_habilitados_da_org: { Args: never; Returns: string[] }
      cleanup_support_audit_events: { Args: never; Returns: number }
      codigos_pai_da_nota: {
        Args: { p_chave: string; p_org: string }
        Returns: string[]
      }
      concluir_ads_rodada: {
        Args: {
          p_advertiser_id?: number
          p_carga_concluida?: boolean
          p_cobertura_desde?: string
          p_custo_listado?: number
          p_custo_resumo?: number
          p_erro?: string
          p_estado: string
          p_org: string
          p_rodada: string
        }
        Returns: boolean
      }
      concluir_execucao: {
        Args: {
          p_acumulado: Json
          p_erro: string
          p_estado: string
          p_job: string
          p_lease: string
          p_notificar: boolean
          p_org: string
        }
        Returns: boolean
      }
      concluir_trafego_rodada: {
        Args: {
          p_carga_concluida?: boolean
          p_erro?: string
          p_estado: string
          p_org: string
          p_rodada: string
        }
        Returns: boolean
      }
      confirmar_inventario: {
        Args: { p_id: string; p_org: string; p_user: string; p_versao: number }
        Returns: Json
      }
      contar_conversas_aguardando: { Args: never; Returns: number }
      current_org_id: { Args: never; Returns: string }
      current_support_scope: {
        Args: never
        Returns: Database["public"]["Enums"]["support_scope"]
      }
      delete_marketplace_connection: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      delete_ml_credentials: { Args: { p_user_id: string }; Returns: undefined }
      desarquivar_organizacao: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      desfazer_nota_compra: {
        Args: {
          p_nota_id: string
          p_org: string
          p_status: string
          p_user: string
        }
        Returns: Json
      }
      desfazer_saque_ml_vendas: { Args: { p_ids: string[] }; Returns: number }
      estornar_estoque: {
        Args: {
          p_canal: string
          p_codigo: string
          p_org: string
          p_ref_venda: string
        }
        Returns: Json
      }
      extensao_registrar_erro: {
        Args: {
          p_ml_item_id: string
          p_motivo: string
          p_org_id: string
          p_tipo: string
          p_versao: string
        }
        Returns: undefined
      }
      extensao_registrar_uso: {
        Args: { p_org_id: string; p_tipo: string; p_user_id: string }
        Returns: undefined
      }
      familia_reservar_migracao_pxv: {
        Args: { p_campos: Json; p_codigo_pai: string; p_org: string }
        Returns: string
      }
      familia_reservar_publicacao: {
        Args: { p_familia_ids: string[]; p_operacao: string; p_org: string }
        Returns: {
          codigo_pai: string
          id: string
          lote_id: string
          motivo: string
          user_id: string
        }[]
      }
      frete_venda_anterior: {
        Args: {
          p_antes: string
          p_ml_item_id: string
          p_order_id: number
          p_org_id: string
          p_variation_id: number
        }
        Returns: {
          frete_vendedor: number
          order_id: number
        }[]
      }
      gerar_foto_inventario_org: {
        Args: { p_data_base: string; p_org: string; p_origem: string }
        Returns: string
      }
      get_connection_tokens: {
        Args: { p_connection_id: string }
        Returns: {
          access_token: string
          conta_externa_id: string
          expires_at: string
          refresh_token: string
        }[]
      }
      get_ml_tokens: {
        Args: { p_user_id: string }
        Returns: {
          access_token: string
          expires_at: string
          refresh_token: string
        }[]
      }
      gravar_ads_conta_dias: {
        Args: {
          p_coletado_em: string
          p_dias: Json
          p_org: string
          p_rodada: string
        }
        Returns: boolean
      }
      gravar_ads_lote: {
        Args: {
          p_coletado_em: string
          p_grupos: Json
          p_org: string
          p_rodada: string
        }
        Returns: boolean
      }
      gravar_marca_familia: {
        Args: { p_codigo_pai: string; p_marca: string; p_org_id: string }
        Returns: Json
      }
      gravar_preco_dia: {
        Args: { p_org: string; p_pontos: Json }
        Returns: undefined
      }
      gravar_trafego_item: {
        Args: { p_itens: Json; p_org: string }
        Returns: undefined
      }
      gravar_visitas_dia: {
        Args: { p_org: string; p_pontos: Json; p_rodada: string }
        Returns: undefined
      }
      importar_nota_compra: {
        Args: { p_itens: Json; p_nota: Json; p_org: string; p_user: string }
        Returns: Json
      }
      inventario_calcular: {
        Args: { p_org: string }
        Returns: {
          codigo: string
          codigo_pai: string
          cor: string
          custo_medio: number
          descricao: string
          marcas: string[]
          ncm: string
          qtd_sem_nota: number
          qtd_valorizada: number
          quantidade_sistema: number
          tamanho: string
          unidade: string
          valor_total: number
        }[]
      }
      inventario_data_base: { Args: { p_agora: string }; Returns: string }
      inventario_foto_json: {
        Args: { p_data_base: string; p_org: string }
        Returns: Json
      }
      inventario_hoje_json: { Args: { p_org: string }; Returns: Json }
      inventario_orgs_elegiveis: { Args: never; Returns: string[] }
      is_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      liberar_execucao: {
        Args: { p_erro: string; p_job: string; p_lease: string; p_org: string }
        Returns: undefined
      }
      liberar_lease_marca: { Args: { p_raiz: string }; Returns: undefined }
      limpar_ads_retencao: { Args: { p_corte: string }; Returns: undefined }
      limpar_movimentos_orfaos: { Args: { p_org: string }; Returns: number }
      marca_da_org: { Args: never; Returns: Json }
      marca_dos_atributos: { Args: { p_attrs: Json }; Returns: Json }
      marcar_mensagens_lidas: { Args: { p_pack_id: string }; Returns: number }
      marcar_notificacoes_lidas: { Args: { p_ids?: string[] }; Returns: number }
      marcar_notificado: {
        Args: { p_job: string; p_lease: string; p_org: string }
        Returns: boolean
      }
      mercado_serie_vendedores: {
        Args: { p_seller_ids: number[] }
        Returns: {
          dia: string
          seller_id: number
          transactions_total: number
        }[]
      }
      modulos_habilitados_da_org: { Args: never; Returns: string[] }
      ncm_consultar: {
        Args: { p_codigos: string[] }
        Returns: {
          codigo: string
          descricao: string
          vigente: boolean
        }[]
      }
      operacoes_massa_reivindicar: {
        Args: { p_ml_item: string; p_operacao: string; p_org: string }
        Returns: boolean
      }
      platform_assert_admin_actor: {
        Args: { p_actor: string }
        Returns: undefined
      }
      platform_assert_sonar_context: {
        Args: { p_actor: string; p_org_id: string; p_support_request?: string }
        Returns: string
      }
      platform_billing_close: {
        Args: {
          p_actor: string
          p_expected_revision: string
          p_month: string
          p_org: string
        }
        Returns: Json
      }
      platform_billing_preview: {
        Args: { p_actor: string; p_month: string; p_org: string }
        Returns: Json
      }
      platform_jwt_role: { Args: never; Returns: string }
      platform_matching_reconciliation: {
        Args: {
          p_gross: number
          p_org: string
          p_sale: string
          p_status: string
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          org_id: string
          reason: string
          refunded_product_cents: number
          sale_id: string
          source_gross_cents: number
          source_status: string
          source_updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_revenue_reconciliations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_org_cost_catalog: {
        Args: { p_org: string; p_since: string }
        Returns: Json
      }
      platform_org_month_validation: {
        Args: { p_org: string; p_since: string }
        Returns: {
          month: string
          org_id: string
          source_count: number
          source_max_updated_at: string
        }[]
      }
      platform_reconcile_revenue: {
        Args: { p_actor: string; p_input: Json }
        Returns: Json
      }
      platform_resolve_terms: {
        Args: { p_on: string; p_org_id: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          modality: number
          monthly_fee_cents: number
          org_id: string
          reason: string
          revenue_bps_t1: number
          revenue_bps_t2: number
          revenue_bps_t3: number
          revenue_bps_t4: number
          setup_due_month: string | null
          setup_fee_cents: number
          sonar_unit_cents: number
          starts_on: string
          timezone: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "platform_commercial_terms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_sale_needs_refund_reconciliation: {
        Args: { p_estorno: number; p_status: string; p_tem_devolucao: boolean }
        Returns: boolean
      }
      platform_save_terms: {
        Args: { p_actor: string; p_input: Json }
        Returns: Json
      }
      platform_sonar_begin: {
        Args: {
          p_actor: string
          p_org_id: string
          p_query: string
          p_query_type: string
          p_reopen_result?: string
          p_request_id: string
          p_schema_version?: number
          p_support_request: string
        }
        Returns: Json
      }
      platform_sonar_complete: {
        Args: {
          p_actor: string
          p_failure_reason?: string
          p_lease_token: string
          p_org_id: string
          p_payload: Json
          p_search_id: string
          p_support_request: string
        }
        Returns: Json
      }
      platform_sonar_delivery_json: {
        Args: {
          p_search: Database["public"]["Tables"]["platform_sonar_searches"]["Row"]
        }
        Returns: Json
      }
      platform_sonar_get_payload: {
        Args: {
          p_actor: string
          p_org_id: string
          p_result_id: string
          p_search_id: string
          p_support_request: string
        }
        Returns: Json
      }
      platform_sonar_log_event: {
        Args: {
          p_actor: string
          p_org_id: string
          p_outcome: string
          p_reason?: string
          p_result_id: string
          p_search_id: string
          p_stage: string
          p_support_request: string
        }
        Returns: string
      }
      platform_sonar_resolve_result: {
        Args: {
          p_actor: string
          p_org_id: string
          p_search_id: string
          p_support_request: string
        }
        Returns: Json
      }
      platform_terms_tier: { Args: { p_base_cents: number }; Returns: number }
      platform_terms_tier_bps: {
        Args: {
          p_base_cents: number
          p_t1: number
          p_t2: number
          p_t3: number
          p_t4: number
        }
        Returns: number
      }
      preparar_republicacao: {
        Args: {
          p_canal: string
          p_codigo_pai: string
          p_familia_alvo: string
          p_org: string
        }
        Returns: {
          familia_id: string
          lote_id: string
          lotes_afetados: string[]
        }[]
      }
      produtos_estoque_resumo: { Args: never; Returns: Json }
      proximo_codigo_produto: {
        Args: { p_org: string; p_qtd: number; p_resync?: boolean }
        Returns: number
      }
      proximo_numero_lote: { Args: { p_org: string }; Returns: number }
      reajuste_ativo_produto: {
        Args: { p_codigo_pai: string; p_org: string }
        Returns: string
      }
      reajuste_codigo_pai: {
        Args: { p_ml_item: string; p_org: string }
        Returns: string
      }
      reajuste_confirmar: {
        Args: { p_confirmacoes: Json; p_operacao: string; p_org: string }
        Returns: string
      }
      reajuste_persistir: {
        Args: {
          p_ml_item: string
          p_operacao: string
          p_org: string
          p_preco_confirmado: number
          p_restaurar: Json
        }
        Returns: string
      }
      reajuste_reivindicar: {
        Args: { p_ml_item: string; p_operacao: string; p_org: string }
        Returns: string
      }
      reajuste_trava_produto: {
        Args: { p_codigo_pai: string; p_org: string }
        Returns: undefined
      }
      reajuste_variacoes_do_mlb: {
        Args: {
          p_codigo_pai: string
          p_ml_item: string
          p_ml_variation_ids: string[]
          p_org: string
        }
        Returns: {
          ml_variation_id: string
          variacao_id: string
        }[]
      }
      reconciliar_backfill_up_candidatas: {
        Args: { p_org_id: string }
        Returns: {
          codigo_pai: string
          familia_id: string
          ml_item_id: string
          user_id: string
        }[]
      }
      reconciliar_backfill_up_upsert: {
        Args: {
          p_codigo_pai: string
          p_family_id: string
          p_ml_item_id: string
          p_org_id: string
          p_permalink: string
          p_sku: string
          p_status: string
          p_user_id: string
          p_user_product_id: string
        }
        Returns: boolean
      }
      reconciliar_convergencia_claim: {
        Args: { p_atualizado_antes: string; p_root_id: string }
        Returns: {
          codigo_pai: string
          criado_em: string
          mudando_composicao_familia_id: string
          org_id: string
          reconciliacao_tentativas: number
          skus_esperados: Json
          titulo: string
        }[]
      }
      registrar_entrada: {
        Args: {
          p_codigo: string
          p_criado_por: string
          p_custo: number
          p_doc: string
          p_obs: string
          p_org: string
          p_qtd: number
          p_ref: string
        }
        Returns: number
      }
      registrar_entrada_nota_pendente: {
        Args: {
          p_chave: string
          p_codigo: string
          p_custo: number
          p_doc: string
          p_org: string
          p_qtd: number
          p_ref: string
          p_user: string
        }
        Returns: number
      }
      registrar_falha_coleta_pulse: {
        Args: { p_org: string; p_produto: string }
        Returns: undefined
      }
      registrar_pendencias_pedido: {
        Args: {
          p_erro: string
          p_falhas: string[]
          p_inicio: string
          p_ok: string[]
          p_org: string
        }
        Returns: {
          descartados: number
        }[]
      }
      registrar_saque_ml_vendas: { Args: { p_ids: string[] }; Returns: number }
      reservar_ads_posse: {
        Args: { p_org: string }
        Returns: {
          cursor: string
          rodada: string
        }[]
      }
      reservar_trafego_posse: {
        Args: { p_org: string }
        Returns: {
          cursor: string
          rodada: string
        }[]
      }
      resumo_mensagens_posvenda: {
        Args: never
        Returns: {
          a_caminho: number
          a_preparar: number
          entregues: number
          nao_lidas_total: number
          respondidas: number
          sem_responder: number
        }[]
      }
      salvar_contagem_inventario: {
        Args: { p_id: string; p_itens: Json; p_org: string; p_versao: number }
        Returns: number
      }
      skus_estoque_org: { Args: never; Returns: Json[] }
      start_support_session: {
        Args: { p_now: string; p_request_id: string; p_requester_id: string }
        Returns: {
          approval_expires_at: string | null
          approved_at: string | null
          cancelled_at: string | null
          created_at: string
          decided_by: string | null
          ended_at: string | null
          expired_at: string | null
          expires_at: string | null
          id: string
          org_id: string
          pending_expires_at: string
          reason: string
          rejected_at: string | null
          renewal_of: string | null
          requester_id: string
          revoked_at: string | null
          revoked_by: string | null
          scope: Database["public"]["Enums"]["support_scope"]
          started_at: string | null
          status: Database["public"]["Enums"]["support_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "support_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      telegram_config_status: {
        Args: never
        Returns: {
          ativo: boolean
          chat_id: string
          comandos_ativos: boolean
          tem_token: boolean
        }[]
      }
      telegram_update_concluir: {
        Args: {
          p_bot: number
          p_erro: string
          p_lease: string
          p_status: string
          p_update: number
        }
        Returns: boolean
      }
      telegram_update_confirmar_posse: {
        Args: {
          p_agora: string
          p_bot: number
          p_lease: string
          p_update: number
        }
        Returns: boolean
      }
      telegram_update_devolver: {
        Args: {
          p_bot: number
          p_erro: string
          p_lease: string
          p_update: number
        }
        Returns: boolean
      }
      telegram_update_reivindicar: {
        Args: { p_agora: string; p_bot: number; p_update: number }
        Returns: {
          bot_id: number
          erro: string | null
          lease_ate: string | null
          lease_id: string | null
          org_id: string
          payload: Json
          processado_em: string | null
          publicado_em: string | null
          recebido_em: string
          status: string
          tentativas: number
          update_id: number
        }[]
        SetofOptions: {
          from: "*"
          to: "telegram_updates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      telegram_updates_parados: {
        Args: {
          p_agora: string
          p_depois_bot: number
          p_depois_update: number
          p_limite: number
        }
        Returns: {
          bot_id: number
          tentativas: number
          update_id: number
        }[]
      }
      tipos_produto_da_org: { Args: never; Returns: string[] }
      upsert_marketplace_connection: {
        Args: {
          p_access_token: string
          p_canal: Database["public"]["Enums"]["canal_externo"]
          p_conta_externa_id: string
          p_conta_label: string
          p_criado_por: string
          p_expires_at: string
          p_me2_habilitado?: boolean
          p_org_id: string
          p_refresh_token: string
          p_scope: string
        }
        Returns: string
      }
      upsert_ml_credentials: {
        Args: {
          p_access_token: string
          p_expires_at: string
          p_ml_nickname: string
          p_ml_user_id: string
          p_refresh_token: string
          p_scope: string
          p_user_id: string
        }
        Returns: undefined
      }
      upsert_ml_devolucao: { Args: { linha: Json }; Returns: Json }
      variacoes_estoque_produto: {
        Args: { p_codigo_pai: string }
        Returns: Json[]
      }
      vendas_kpis_janela: {
        Args: { p_ate: string; p_desde: string; p_org: string }
        Returns: Json
      }
      vendas_sku_catalogo: { Args: never; Returns: Json[] }
      vendas_sku_codigos_mlbs: { Args: { p_mlbs: string[] }; Returns: Json }
      vendas_sku_dossie_ids: {
        Args: { p_codigos: string[] }
        Returns: string[]
      }
      vendas_sku_mlbs: { Args: { p_codigos: string[] }; Returns: Json }
      vitrine_resumo: {
        Args: { p_fim: string; p_inicio: string }
        Returns: Json
      }
    }
    Enums: {
      canal_externo: "mercado_livre"
      classe_concorrencia: "sem" | "moderada" | "alta"
      cor_origem: "descricao" | "vision" | "manual"
      estrategia_preco: "proprio" | "competitivo" | "manual"
      familia_status:
        | "pendente"
        | "processando"
        | "pronto"
        | "publicando"
        | "publicado"
        | "erro"
      lote_status:
        | "importando"
        | "processando"
        | "revisao"
        | "publicando"
        | "concluido"
        | "erro"
      operacao_ml: "CREATE" | "UPDATE"
      origem_concorrencia: "gtin" | "titulo" | "nenhuma"
      origem_produto: "nacional" | "importado"
      support_audit_event:
        | "request_created"
        | "request_cancelled"
        | "request_approved"
        | "request_rejected"
        | "session_started"
        | "session_ended"
        | "session_expired"
        | "session_revoked"
        | "renewal_requested"
        | "operation"
        | "notification_delivery_failed"
      support_audit_result: "succeeded" | "failed" | "denied"
      support_scope: "read" | "full"
      support_status:
        | "pending"
        | "approved"
        | "active"
        | "rejected"
        | "cancelled"
        | "expired"
        | "revoked"
        | "ended"
      tipo_aviamento: "linha" | "botao" | "fita" | "outro" | "cola" | "cursor"
      tipo_origem: "regex" | "ia" | "manual" | "preditor" | "generico"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      canal_externo: ["mercado_livre"],
      classe_concorrencia: ["sem", "moderada", "alta"],
      cor_origem: ["descricao", "vision", "manual"],
      estrategia_preco: ["proprio", "competitivo", "manual"],
      familia_status: [
        "pendente",
        "processando",
        "pronto",
        "publicando",
        "publicado",
        "erro",
      ],
      lote_status: [
        "importando",
        "processando",
        "revisao",
        "publicando",
        "concluido",
        "erro",
      ],
      operacao_ml: ["CREATE", "UPDATE"],
      origem_concorrencia: ["gtin", "titulo", "nenhuma"],
      origem_produto: ["nacional", "importado"],
      support_audit_event: [
        "request_created",
        "request_cancelled",
        "request_approved",
        "request_rejected",
        "session_started",
        "session_ended",
        "session_expired",
        "session_revoked",
        "renewal_requested",
        "operation",
        "notification_delivery_failed",
      ],
      support_audit_result: ["succeeded", "failed", "denied"],
      support_scope: ["read", "full"],
      support_status: [
        "pending",
        "approved",
        "active",
        "rejected",
        "cancelled",
        "expired",
        "revoked",
        "ended",
      ],
      tipo_aviamento: ["linha", "botao", "fita", "outro", "cola", "cursor"],
      tipo_origem: ["regex", "ia", "manual", "preditor", "generico"],
    },
  },
} as const
