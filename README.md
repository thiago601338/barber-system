# Barber System

Sistema de gestão de barbearias com painel master, painéis próprios por barbearia e barbeiro, área do cliente e página pública de agendamento. Frontend em React/Vite, dados e autenticação no Supabase, APIs no Netlify.

## Funcionalidades

- Painel e relatórios de faturamento, ticket médio, primeira visita, clientes novos, retenção e desempenho por profissional.
- Agenda com disponibilidade por barbeiro, serviços, histórico do cliente, procedimentos e química.
- Produtos, comanda do bar/cozinha, despesas, estrutura, lucro alvo, metas da barbearia e metas pessoais.
- Assinaturas de clientes ligadas à conta Mercado Pago da própria barbearia; consumo e agendamentos ligados aos limites de uso.
- Admin master cria barbearias, convida administradores e define o preço mensal por barbeiro da plataforma. A cobrança central permanece desativada até configuração explícita.
- Administrador da barbearia libera abas individualmente para cada barbeiro. O banco limita cada barbeiro aos dados de clientes atendidos por ele.
- Parceiros, guia de marketing guardado no banco, solicitações de análise por IA e conexão opcional do Instagram profissional/conta de anúncios.
- Mini bio por barbearia com links para produtos, assinatura, WhatsApp e agendamento.
- Aba Passo a Passo com 66 etapas em português, trilhas por perfil e módulo, atalhos para a tela certa e progresso individual salvo no Supabase.

## Iniciar localmente

1. Instale Node.js compatível com Vite 8 e execute `npm ci`.
2. Copie `.env.example` para `.env.local`; preencha apenas a URL e a **chave publicável** do Supabase. `.env.local` é ignorado pelo Git.
3. Aplique a migração de `supabase/migrations/` ao projeto Supabase. Ela cria tabelas, políticas RLS, funções e o guia inicial de marketing.
4. Execute `npm run dev` para a interface. Para testar as Functions com as variáveis de servidor, use `netlify dev`.

Variáveis de navegador: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. A chave `service_role` nunca deve receber prefixo `VITE_` nem entrar no repositório.

## Configuração do servidor

No projeto Netlify, configure em **Functions**:

| Variável | Finalidade |
| --- | --- |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SECRET_KEY` | Chave secreta moderna, só no servidor, para convites, integrações e conciliação |
| `MASTER_EMAIL` | E-mail confirmado que pode ativar o primeiro acesso master |
| `TOKEN_ENCRYPTION_KEY` | 32 bytes aleatórios em base64 para cifrar tokens OAuth |
| `MP_*` | Aplicação e contas Mercado Pago; detalhes em [docs/mercadopago.md](docs/mercadopago.md) |
| `META_*` | Aplicação Meta e OAuth; detalhes em [docs/instagram.md](docs/instagram.md) |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | Injetadas automaticamente pelo Netlify AI Gateway após o primeiro deploy de produção; habilitam as análises de IA |

No **build** do Netlify, configure também `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. A migração configura `platform_settings.billing_enabled=false` e preço por barbeiro igual a zero; o master define ambos pelo painel.

## Primeiro acesso

1. Configure `MASTER_EMAIL` no servidor.
2. Crie a conta com esse e-mail na tela inicial e confirme o e-mail.
3. Entre e clique em **Ativar acesso master**. A API compara o e-mail confirmado com `MASTER_EMAIL` e recusa outro usuário.
4. No painel master, crie a barbearia e convide seus administradores. Cada administrador configura equipe, serviços, preços, agenda e integrações.

Os clientes criam conta pelo link público `/b/slug-da-barbearia`. O administrador pode associá-los à sua barbearia. O agendamento e a área do cliente consultam o limite da assinatura confirmado no banco.

## Segurança e validação

Dados de cada barbearia são separados no PostgreSQL por `barbershop_id` e políticas RLS. Tokens de provedores ficam cifrados em uma tabela acessível apenas ao servidor. Webhooks Mercado Pago verificam assinatura, consultam o recurso oficial e aplicam idempotência. O navegador nunca recebe chaves secretas.

Rode `npm run typecheck` e `npm run build` antes de publicar. Após implantar, teste com contas reais separadas (master, admin, barbeiro e cliente) para comprovar isolamento, convites, agendamento, assinatura e retorno de webhook. Conexões Mercado Pago, Pix recorrente, anúncios e IA só funcionam após credenciais e validação controlada de cada provedor.

## Referência observada no Cashbarber

Foi verificada a navegação de Agenda, Assinaturas, Bar/Cozinha, Financeiro, Marketing e Relatórios na sessão aberta pelo usuário. Os relatórios separam **Cadastro** e **Primeira visita** para clientes novos, além de tickets por atendimento e por cliente distinto. O nosso sistema usa definições explícitas para esses indicadores; telas sem dados no Cashbarber não permitiram confirmar fórmulas internas.
