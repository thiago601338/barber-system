# Mercado Pago — integração do Barber System

## Configuração de servidor

Configure somente no ambiente de Functions, nunca com prefixo `VITE_`:

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Acesso privilegiado de servidor ao projeto Supabase |
| `TOKEN_ENCRYPTION_KEY` | Chave aleatória de 32 bytes em base64; cifra tokens OAuth e o estado PKCE com AES-GCM |
| `MP_CLIENT_ID`, `MP_CLIENT_SECRET` | Aplicação Mercado Pago que conecta cada barbearia por OAuth |
| `MP_OAUTH_REDIRECT_URI` | URL HTTPS exata `https://SEU-DOMINIO/api/mercadopago/oauth-callback`, cadastrada na aplicação |
| `MP_OAUTH_RETURN_URL` | URL HTTPS opcional para voltar à interface após a conexão |
| `MP_WEBHOOK_SECRET` | Assinatura secreta do webhook da aplicação das barbearias |
| `MP_CUSTOMER_BACK_URL` | URL HTTPS de retorno do checkout da assinatura do cliente |
| `MP_PLATFORM_ACCESS_TOKEN`, `MP_PLATFORM_ACCOUNT_ID` | Token e ID do vendedor da conta central, separados das contas das barbearias |
| `MP_PLATFORM_WEBHOOK_SECRET` | Assinatura secreta do webhook da aplicação/conta central |
| `MP_SAAS_BACK_URL` | URL HTTPS de retorno do checkout SaaS |

Na aplicação OAuth, habilite **Authorization code com PKCE** e conceda `read write offline_access`. Configure os tópicos `subscription_preapproval`, `subscription_authorized_payment` e `payment` nos dois webhooks, conforme a aplicação correspondente. O webhook das barbearias usa `/api/mercadopago/webhook`; o central usa `/api/mercadopago/platform-webhook`. Use URLs públicas HTTPS.

## Endpoints

Todas as rotas estão em `/api/mercadopago/:action`. As rotas autenticadas recebem `Authorization: Bearer <access_token_supabase>`.

| Método e ação | Quem pode usar | Entrada/resultado |
| --- | --- | --- |
| `POST oauth-start` | Administrador da barbearia | `{barbershop_id}` → `authorization_url`; define cookie HttpOnly de 10 minutos para `state` e `code_verifier` |
| `GET oauth-callback` | Retorno do Mercado Pago | Troca o `code` com PKCE e guarda os tokens cifrados em `integration_credentials` |
| `GET connection?barbershop_id=...` | Administrador da barbearia | Estado da conexão, sem devolver tokens |
| `POST subscription-start` | Administrador ou cliente vinculado por `clients.user_id` | `{barbershop_id,client_id,plan_id}` → ID local e `checkout_url` |
| `GET subscription-status?subscription_id=...` | Administrador ou cliente vinculado | Consulta `/preapproval/{id}` antes de atualizar o estado local |
| `POST subscription-cancel` | Administrador ou cliente vinculado | `{subscription_id}` → cancela no Mercado Pago e confirma por consulta |
| `POST webhook`, `POST platform-webhook` | Mercado Pago | Exigem HMAC válido; consultam o recurso oficial antes de persistir; usam `provider_events` para idempotência |
| `GET saas-quote?barbershop_id=...` | Administrador master | Barbeiros ativos × `platform_settings.seat_price_cents`; informa se `billing_enabled` está ativo |
| `POST saas-start` | Administrador master | `{barbershop_id,payer_email}` → checkout pendente na conta central |
| `GET saas-status?barbershop_id=...` | Administrador master | Consulta e compara a assinatura central com a cotação atual |
| `POST saas-sync` | Administrador master | `{barbershop_id}` → concilia imediatamente uma assinatura já criada; a rotina automática também faz isso |
| `POST saas-cancel` | Administrador master | `{barbershop_id}` → cancela e confirma a assinatura central |

`saas-start` rejeita a operação enquanto `platform_settings.billing_enabled=false`. `saas-sync` pode ser usado mesmo com a cobrança desativada para pausar uma assinatura já existente. A conta central usa `platform_subscriptions` e `platform_invoices`; pagamentos dos clientes das barbearias usam `subscriptions` e `payments`.

## Conciliação automática da mensalidade SaaS

Após a implantação publicada na Netlify, `saas-reconcile` executa a cada cinco minutos (cron em UTC). A função não tem rota HTTP pública e usa somente as credenciais do servidor. Cada execução reserva até quatro assinaturas existentes por atualização condicional de `last_reconciled_at`; falhas voltam à fila nas execuções seguintes. Alterações de barbeiros ativos, preço master ou `billing_enabled` priorizam a assinatura afetada na fila. O campo `billing_enabled` nasce **false** no banco: a rotina não cria assinaturas nem inicia cobrança sem checkout aprovado pelo pagador.

Para assinaturas autorizadas, a rotina consulta a assinatura oficial e só altera o valor quando `barbeiros ativos × preço master` diverge. Com zero barbeiros ativos, barbearia inativa ou `billing_enabled=false`, ela pausa a assinatura no Mercado Pago; um checkout ainda pendente é cancelado. Uma assinatura pausada pelo sistema é reativada com o valor atualizado quando as condições voltam a permitir cobrança. Pausas manuais não são reativadas pela rotina (`auto_paused=false`). Se o Mercado Pago não confirmar a alteração, a rotina registra a falha e tenta novamente; o master pode usar **Conciliar cobrança agora** para conferir o estado.

O banco registra o histórico de quantidade e preço em `platform_subscription_rates`. No webhook, uma cobrança atrasada é comparada à fatura oficial do Mercado Pago e ao preço registrado quando aquela fatura foi criada. O ID de uma assinatura central cancelada permanece identificável nesse histórico após um novo checkout. `platform_invoices.provider_invoice_id` distingue duas faturas legítimas da mesma barbearia no mesmo mês, inclusive após cancelamento e recriação. Se não houver tarifa histórica verificável, o evento fica pendente para conciliação, sem atribuir assentos ou preço por adivinhação.

O Mercado Pago não oferece valor recorrente zero nesse fluxo; por isso a pausa impede que o último valor positivo continue sendo cobrado. A execução agendada tem limite de 30 segundos, então processa um lote limitado por vez; com muitas barbearias, a atualização pode demorar mais que cinco minutos. Confira as condições comerciais aceitas pelo assinante antes de habilitar ajustes automáticos de preço. Não houve teste de cobrança real.

## Limites operacionais

- O checkout pendente deixa o comprador escolher o meio de pagamento oferecido pelo Mercado Pago, incluindo Pix quando estiver disponível para aquela conta e fluxo. **Não se afirma que Pix automático recorrente esteja habilitado** antes de validação com o Mercado Pago.
- Um `POST /preapproval` pode ter sido processado mesmo que a rede tenha falhado. Nessa situação a assinatura local fica pendente, sem ID do provedor, e a API bloqueia a repetição automática. Faça conciliação pela `external_reference` antes de tentar outra criação. O mesmo vale para cobrança SaaS.
- Assinaturas que ficaram pendentes sem ID do provedor exigem conciliação manual pela `external_reference`; a rotina não cria outra assinatura.
- O webhook só ativa o período de uso de uma assinatura do cliente após consultar um pagamento aprovado do Mercado Pago. A disponibilidade real dos meios de pagamento, o OAuth e os webhooks exigem teste controlado em ambiente de teste e validação posterior na conta produtiva.

## Fontes oficiais

- [OAuth com PKCE](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation)
- [Renovação OAuth](https://www.mercadopago.com.br/developers/pt/docs/split-payments/additional-content/security/oauth/renewal)
- [Assinatura com pagamento pendente](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments)
- [API de assinaturas](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/overview)
- [Pausar, reativar e alterar o valor da assinatura](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management)
- [Funções agendadas da Netlify](https://docs.netlify.com/build/functions/scheduled-functions/)
- [Busca de faturas por pagamento](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/authorized-payment-search/get)
- [Assinatura dos webhooks](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/optional-notifications)
