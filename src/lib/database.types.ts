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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
          metadados_canal: Json
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
          metadados_canal?: Json
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
          metadados_canal?: Json
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
          aliquota_importado_pct: number
          aliquota_interna_pct: number | null
          aliquota_nacional_pct: number
          aliquotas_confirmadas_em: string | null
          atualizado_em: string
          criado_em: string
          desconto_concorrencia_pct: number
          desconto_pct: number
          mostrar_lucro_dashboard: boolean
          org_id: string
          reancora_lider_ativa: boolean
          telegram_ativo: boolean
          telegram_bot_token: string | null
          telegram_chat_id: string | null
          uf_empresa: string | null
          user_id: string | null
        }
        Insert: {
          ai_model_imagem?: string | null
          ai_model_texto?: string | null
          aliquota_importado_pct?: number
          aliquota_interna_pct?: number | null
          aliquota_nacional_pct?: number
          aliquotas_confirmadas_em?: string | null
          atualizado_em?: string
          criado_em?: string
          desconto_concorrencia_pct?: number
          desconto_pct?: number
          mostrar_lucro_dashboard?: boolean
          org_id: string
          reancora_lider_ativa?: boolean
          telegram_ativo?: boolean
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          uf_empresa?: string | null
          user_id?: string | null
        }
        Update: {
          ai_model_imagem?: string | null
          ai_model_texto?: string | null
          aliquota_importado_pct?: number
          aliquota_interna_pct?: number | null
          aliquota_nacional_pct?: number
          aliquotas_confirmadas_em?: string | null
          atualizado_em?: string
          criado_em?: string
          desconto_concorrencia_pct?: number
          desconto_pct?: number
          mostrar_lucro_dashboard?: boolean
          org_id?: string
          reancora_lider_ativa?: boolean
          telegram_ativo?: boolean
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
          id: string
          kit_base_codigo_pai: string | null
          kit_multiplicador: number | null
          lote_id: string
          ml_item_id: string | null
          ml_permalink: string | null
          mudanca_estrutural: Json | null
          ncm: string | null
          nome_pai: string
          observacao_operador: string | null
          operacao: Database["public"]["Enums"]["operacao_ml"]
          org_id: string
          origem: Database["public"]["Enums"]["origem_produto"]
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
          id?: string
          kit_base_codigo_pai?: string | null
          kit_multiplicador?: number | null
          lote_id: string
          ml_item_id?: string | null
          ml_permalink?: string | null
          mudanca_estrutural?: Json | null
          ncm?: string | null
          nome_pai: string
          observacao_operador?: string | null
          operacao: Database["public"]["Enums"]["operacao_ml"]
          org_id: string
          origem?: Database["public"]["Enums"]["origem_produto"]
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
          id?: string
          kit_base_codigo_pai?: string | null
          kit_multiplicador?: number | null
          lote_id?: string
          ml_item_id?: string | null
          ml_permalink?: string | null
          mudanca_estrutural?: Json | null
          ncm?: string | null
          nome_pai?: string
          observacao_operador?: string | null
          operacao?: Database["public"]["Enums"]["operacao_ml"]
          org_id?: string
          origem?: Database["public"]["Enums"]["origem_produto"]
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
            foreignKeyName: "familias_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
          atualizado_em: string
          claim_id: number
          criado_em: string
          fechado_em: string | null
          id: string
          order_id: number | null
          org_id: string
          raw: Json | null
          reason_id: string | null
          reason_texto: string | null
          return_status: string | null
          return_status_money: string | null
          stage: string | null
          status: string | null
          type: string | null
          user_id: string
          valor_em_jogo: number | null
        }
        Insert: {
          aberto_em?: string | null
          acoes_pendentes?: Json | null
          atualizado_em?: string
          claim_id: number
          criado_em?: string
          fechado_em?: string | null
          id?: string
          order_id?: number | null
          org_id: string
          raw?: Json | null
          reason_id?: string | null
          reason_texto?: string | null
          return_status?: string | null
          return_status_money?: string | null
          stage?: string | null
          status?: string | null
          type?: string | null
          user_id: string
          valor_em_jogo?: number | null
        }
        Update: {
          aberto_em?: string | null
          acoes_pendentes?: Json | null
          atualizado_em?: string
          claim_id?: number
          criado_em?: string
          fechado_em?: string | null
          id?: string
          order_id?: number | null
          org_id?: string
          raw?: Json | null
          reason_id?: string | null
          reason_texto?: string | null
          return_status?: string | null
          return_status_money?: string | null
          stage?: string | null
          status?: string | null
          type?: string | null
          user_id?: string
          valor_em_jogo?: number | null
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
          message_id: string
          order_id: string | null
          order_status: string | null
          org_id: string | null
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
          message_id: string
          order_id?: string | null
          order_status?: string | null
          org_id?: string | null
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
          message_id?: string
          order_id?: string | null
          order_status?: string | null
          org_id?: string | null
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
      ml_vendas: {
        Row: {
          atualizado_em: string
          canal: string
          cidade: string | null
          comprador_id: number | null
          comprador_nick: string | null
          comprador_nome: string | null
          criado_em: string
          currency: string
          date_closed: string | null
          date_created: string | null
          estorno: number | null
          frete_vendedor: number | null
          id: string
          is_publiai: boolean
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
          currency?: string
          date_closed?: string | null
          date_created?: string | null
          estorno?: number | null
          frete_vendedor?: number | null
          id?: string
          is_publiai?: boolean
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
          currency?: string
          date_closed?: string | null
          date_created?: string | null
          estorno?: number | null
          frete_vendedor?: number | null
          id?: string
          is_publiai?: boolean
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
      notificacoes: {
        Row: {
          categoria: string
          criada_em: string
          id: string
          lida: boolean
          org_id: string
          texto: string
          user_id: string
        }
        Insert: {
          categoria: string
          criada_em?: string
          id?: string
          lida?: boolean
          org_id: string
          texto: string
          user_id: string
        }
        Update: {
          categoria?: string
          criada_em?: string
          id?: string
          lida?: boolean
          org_id?: string
          texto?: string
          user_id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          atualizado_em: string
          canais_habilitados: string[]
          criado_em: string
          id: string
          is_test: boolean
          lote_seq: number
          marca_padrao: string | null
          modulos_habilitados: string[]
          nome: string
          produto_seq: number
          slug: string
          tipo_pessoa: string
        }
        Insert: {
          atualizado_em?: string
          canais_habilitados?: string[]
          criado_em?: string
          id?: string
          is_test?: boolean
          lote_seq?: number
          marca_padrao?: string | null
          modulos_habilitados?: string[]
          nome: string
          produto_seq?: number
          slug: string
          tipo_pessoa?: string
        }
        Update: {
          atualizado_em?: string
          canais_habilitados?: string[]
          criado_em?: string
          id?: string
          is_test?: boolean
          lote_seq?: number
          marca_padrao?: string | null
          modulos_habilitados?: string[]
          nome?: string
          produto_seq?: number
          slug?: string
          tipo_pessoa?: string
        }
        Relationships: []
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
      is_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      limpar_movimentos_orfaos: { Args: { p_org: string }; Returns: number }
      marcar_mensagens_lidas: { Args: { p_pack_id: string }; Returns: number }
      marcar_notificacoes_lidas: { Args: { p_ids?: string[] }; Returns: number }
      mercado_serie_vendedores: {
        Args: { p_seller_ids: number[] }
        Returns: {
          dia: string
          seller_id: number
          transactions_total: number
        }[]
      }
      modulos_habilitados_da_org: { Args: never; Returns: string[] }
      produtos_estoque_resumo: { Args: never; Returns: Json }
      proximo_codigo_produto: {
        Args: { p_org: string; p_qtd: number; p_resync?: boolean }
        Returns: number
      }
      proximo_numero_lote: { Args: { p_org: string }; Returns: number }
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
      registrar_saque_ml_vendas: { Args: { p_ids: string[] }; Returns: number }
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
          tem_token: boolean
        }[]
      }
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
      variacoes_estoque_produto: {
        Args: { p_codigo_pai: string }
        Returns: Json[]
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
  graphql_public: {
    Enums: {},
  },
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
