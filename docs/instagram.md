# Instagram profissional e anúncios

O botão **Conectar Instagram** usa Facebook Login da Meta. A conta Instagram precisa ser profissional e estar vinculada a uma Página do Facebook. Para ler anúncios, o usuário também precisa autorizar uma conta de anúncios; a aplicação pode precisar de análise e permissões avançadas da Meta antes de atender outras empresas.

## Variáveis Netlify Functions

| Variável | Valor |
| --- | --- |
| `META_APP_ID`, `META_APP_SECRET` | Aplicação configurada em Meta for Developers |
| `META_GRAPH_VERSION` | Versão da Graph API aprovada na aplicação, formato `vN.N` |
| `META_OAUTH_REDIRECT_URI` | `https://SEU-DOMINIO/api/instagram/callback`, igual ao URI cadastrado na Meta |
| `META_OAUTH_RETURN_URL` | URL HTTPS opcional para voltar ao painel após OAuth |
| `TOKEN_ENCRYPTION_KEY` | Mesma chave de 32 bytes em base64 usada pelas demais integrações |

Permissões solicitadas: `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights` e `ads_read`. A disponibilidade depende do estado da aplicação e das permissões concedidas.

## API

Todas as rotas, exceto o callback OAuth, exigem `Authorization: Bearer <token Supabase>` de um **administrador da barbearia**.

| Rota | Função |
| --- | --- |
| `POST /api/instagram/start` | `{barbershop_id}` → URL de autorização, `state` cifrado em cookie HttpOnly |
| `GET /api/instagram/callback` | Troca o código por token longo, cifra e grava no servidor |
| `GET /api/instagram/accounts?barbershop_id=...` | Lista Páginas com Instagram profissional e contas de anúncios disponíveis |
| `POST /api/instagram/select` | Escolhe `{barbershop_id,instagram_user_id,ad_account_id?}` após validar posse na Meta |
| `GET /api/instagram/status?barbershop_id=...` | Estado da conexão sem expor token |
| `GET /api/instagram/insights?barbershop_id=...` | Seguidores, publicações recentes e métricas dos anúncios dos últimos 30 dias |
| `POST /api/instagram/disconnect` | Apaga token e vínculo local |

A IA pode usar métricas agregadas consultadas no momento da solicitação; o texto marca quando a conta não está conectada ou os dados de anúncios estão indisponíveis. Ela não calcula vendas ou retorno de anúncios sem conversões verificadas.

## Fontes oficiais

- [Instagram API com Facebook Login](https://www.postman.com/meta/instagram/folder/9cgqucg/instagram-api-with-facebook-login)
- [Meta Marketing API](https://www.postman.com/meta/facebook-marketing-api/collection/0zr4mes/facebook-marketing-api-mapi)
- [Insights de conta de anúncios](https://www.postman.com/meta/facebook-marketing-api/request/u38qbri/get-insight-details-from-an-adaccount-l4)
