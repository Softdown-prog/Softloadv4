# Softload V4 — produto focado em templates Blogger

Escopo aprovado em 29/10/2026: o produto público da Softload passa a ser **somente criação/compilação de templates XML do Blogger**. A7 Forge 2D deixa de ser uma oferta e não deve aparecer em páginas, menus, chamadas HTTP ativas nem na imagem Lite.

## Experiência
1. A página inicial `/` apresenta benefícios, editor, passos de uso, planos, FAQ e acesso a contato, privacidade e termos.
2. A rota pública `/criar` permite experimentar sem cadastro. Usa o mesmo compilador validado que os usuários autenticados.
3. Sem cadastro: **2 XML por sessão HTTP do navegador**, com CSRF, validação de origem e limite por IP; cookies limpos podem iniciar outra sessão. Não apresentar isso como cota inviolável/lifetime.
4. A conta Firebase permanece opcional para testes e obrigatória somente se o usuário quiser limites associados à conta, histórico, armazenamento ou comprar plano. Conta gratuita continua com regra legada de até dois downloads ligados ao cadastro.
5. Pagamentos Mercado Pago, webhook e arquivos anteriores não são apagados nem alterados nesta entrega. O plano Essencial ainda depende da flag de homologação.

## Editor (sem IA)
- 15 nichos existentes, compilação a partir do zero, paletas, tipografia, grade e barra lateral.
- Prévia **ilustrativa** não é promessa de correspondência pixel a pixel no Blogger.
- Botão de combinações aleatórias de estilo e preferência local no dispositivo. Nenhum custo de API.
- XML validado antes de entregar e com cabeçalhos contra cache e interpretação MIME.

## Retirada do A7 Forge em fases
- **Fase 1:** desaparecer do site, menu, fluxo ativo HTTP e Dockerfile.lite; CI garante regressões de acesso.
- **Fase 2:** retirar arquivos/depêndencias Forge e test workflows legados somente quando o workflow/receptor de produção e o contêiner Agent forem alterados em conjunto, com rollback. O Dockerfile de produção ainda usa a imagem anterior até migração segura; não apagar dados ou outros arquivos do usuário.

## Limites do visitante
O limite de dois XML por sessão é uma proteção de UX, e o rate-limit protege o endpoint; limpar cookies ou trocar de dispositivo reinicia a sessão. Para uma política estrita por identidade seriam necessários login, CAPTCHA/abuse detection, limites adicionais e estudo de privacidade.

## Segurança de implantação
Não alterar `softload-deploy:v2:app,agent` por conta própria. Preserve uma imagem válida anterior, confirme health, webhook e download do histórico. O fluxo principal da VPS seguirá usando `Dockerfile` até existir novo contrato do receptor.
