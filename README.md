# Barber System

Sistema de gestão de barbearias com painel master, painéis próprios por barbearia e barbeiro, área do cliente e página pública de agendamento. Frontend em React/Vite, dados e autenticação no Supabase, APIs no Netlify.

**Site publicado:** https://barber-system-yqu5.netlify.app — após enviar alterações ao ramo `main` do GitHub, publique uma nova versão no projeto Netlify vinculado e confirme o estado `ready` antes de anunciar o resultado.

O esquema e as migrações deste repositório já foram aplicados ao projeto Supabase `oyjiiqbsbshfdgdaxbus`. A cobrança central permanece desativada até configuração e ativação pelo master. Mercado Pago e Meta/Instagram ainda precisam das credenciais dos aplicativos e de testes controlados antes de uso real.

## Funcionalidades

- Painel e relatórios de faturamento, ticket médio, primeira visita, clientes novos, retenção e desempenho por profissional.
- Em Relatórios, a aba **Fluxo** mostra atendimentos concluídos por hora, dia e mês no fuso da barbearia, em períodos de até 370 dias. A permissão Relatórios é independente da permissão Agenda.
- Agenda com disponibilidade por barbeiro, serviços, histórico do cliente, procedimentos e química.
- Produtos, comanda do bar/cozinha, despesas, estrutura, lucro alvo, metas da barbearia e metas pessoais.
- Assinaturas de clientes ligadas à conta Mercado Pago da própria barbearia; consumo e agendamentos ligados aos limites de uso.
- Admin master cria barbearias, convida administradores e define, por barbearia, uma mensalidade fixa e um valor mensal por barbeiro ativo. O recebimento central depende da configuração do Mercado Pago e da aprovação da assinatura pelo pagador.
- Administrador da barbearia libera abas individualmente para cada barbeiro. O banco limita cada barbeiro aos dados de clientes atendidos por ele.
- **Clube do Parceiro** com perfil da parceria, logo, ofertas, código próprio, link de indicação, vigência opcional, desconto, serviço elegível, gasto mínimo e limites de uso. No agendamento público, o cliente consulta o desconto e o valor final antes de reservar; a confirmação revalida as regras e registra a atribuição ao parceiro com uma cópia das condições da oferta. Resultados por parceiro e cupom, período de até 370 dias, reservas, visitas concluídas, uso total por cupom e CSV das 500 reservas mais recentes carregadas.
- **Ajuda de IA** para master, administrador e barbeiro autorizado: aceita perguntas livres e pedidos de cadastro na mesma conversa. Respostas consultivas não alteram registros; ações disponíveis mostram os campos para revisão e exigem confirmação separada. O histórico pertence ao solicitante. As cotas em 24 horas são de 50 pedidos para master, 20 para administrador e 10 para barbeiro. O barbeiro precisa da permissão IA e, para cadastrar meta pessoal ou tarefa, também da aba correspondente. A IA não altera pagamentos, convites, permissões nem clientes; cliente não acessa essa área.
- Guia de marketing guardado no banco e conexão opcional do Instagram profissional/conta de anúncios.
- Mini bio por barbearia com links para produtos, assinatura, WhatsApp e agendamento.
- Identidade visual própria por barbearia: link do Instagram, proposta de cores e tipografia com IA, prévia e publicação pelo administrador. Gestão, barbeiro, cliente, acesso e página pública usam o tema aprovado. A [Kingsman](https://barber-system-yqu5.netlify.app/b/kingsman) é a primeira identidade configurada; detalhes em [docs/branding.md](docs/branding.md).
- Aba Passo a Passo com tour interativo: pop-up, seta e destaque na tela; avança entre as abas disponíveis conforme o perfil e as permissões. O progresso dos guias vistos fica neste dispositivo.

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

Se o serviço de e-mail atingir o limite ao convidar um integrante, o painel gera um link individual para o administrador copiar e compartilhar com a pessoa. O e-mail não é enviado nessa alternativa. O convite também pode ser gerado novamente para uma conta ainda não confirmada.

Os clientes criam conta pelo link público `/b/slug-da-barbearia`. O administrador pode associá-los à sua barbearia. O agendamento e a área do cliente consultam o limite da assinatura confirmado no banco.

O cupom do Clube do Parceiro altera o **valor da reserva**, mas a reserva não é um pagamento. Os resultados do Clube mostram valores reservados e descontos, não receita recebida nem comissão de parceiros. Serviços mantêm o preço de tabela no histórico; o total do agendamento guarda o valor com desconto. Catálogo de produtos exibe itens e permite pedir pelo WhatsApp; não há pagamento de produtos nessa página. Cupom e uso de assinatura não são acumuláveis.

O Clube atribui agendamentos da própria barbearia; não oferece login separado ao parceiro, comissão automática ou resgate em estabelecimentos externos. As regras completas do cupom são preservadas apenas nas reservas feitas após a migração de histórico da oferta; reservas anteriores não recebem condições reconstruídas.

## Segurança e validação

Dados de cada barbearia são separados no PostgreSQL por `barbershop_id` e políticas RLS. Tokens de provedores ficam cifrados em uma tabela acessível apenas ao servidor. Webhooks Mercado Pago verificam assinatura, consultam o recurso oficial e aplicam idempotência. O navegador nunca recebe chaves secretas.

Rode `npm run typecheck` e `npm run build` antes de publicar. Após implantar, teste com contas reais separadas (master, admin, barbeiro e cliente) para comprovar isolamento, convites, agendamento, assinatura e retorno de webhook. Mercado Pago, Pix recorrente e anúncios dependem das credenciais e da validação controlada de cada provedor. As análises de IA dependem do AI Gateway habilitado na Netlify e de teste na implantação publicada.

## Referência observada no Cashbarber

Foi verificada a navegação de Agenda, Assinaturas, Bar/Cozinha, Financeiro, Marketing e Relatórios na sessão aberta pelo usuário. Os relatórios separam **Cadastro** e **Primeira visita** para clientes novos, além de tickets por atendimento e por cliente distinto. O nosso sistema usa definições explícitas para esses indicadores; telas sem dados no Cashbarber não permitiram confirmar fórmulas internas.
