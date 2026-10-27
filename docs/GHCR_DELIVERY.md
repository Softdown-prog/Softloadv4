# Recuperação do deploy Softload V4 sem enviar centenas de MB por SSH

## Diagnóstico comprovado em 27/10/2026

- `main`: `206c8492fbd453c90d28e829050b096951989617`.
- `/health` público: `65769cbbb15592caa0f7b0d3e13e82de5dbd490a` (HTTP 200, mas atrasado).
- A transferência `docker save | gzip -1 | rsync` de ~387 MB falhou com 24 tentativas de 180 segundos; ~30–50 KB/s.
- Download **HTTPS da VPS** num teste de apenas 4 MiB: ~7,4 MB/s de Cloudflare; HTTP do GHCR respondeu 401 (endpoint alcançável, exigindo credenciais).
- Comparação de velocidades não garante desempenho do GHCR com centenas de MB ou todas as redes.
- Nenhuma execução chegou a ativar o novo SHA; evite confiar só no `healthy` do container.

## Entrega em fases, mantendo segurança

1. Execute manualmente o workflow `Bootstrap private GHCR packages (inert images only)` em Actions. **Ele publica apenas duas imagens vazias**, sem código da Softload, para testar a visibilidade. Não executa deploy. O workflow falha se as imagens não forem **privadas**. Se não for possível verificar privacidade, não prossiga.
2. Se ambos os pacotes confirmarem `visibility=private`, execute manualmente `Stage Softload images in verified PRIVATE GHCR` contra a `main` atual. O workflow constrói primeiro cada imagem **localmente**; reconfirma a SHA atual e a privacidade imediatamente antes de `docker push`, confere a privacidade novamente depois e registra o identificador imutável `ghcr.io/<owner>/softloadv4-production-<serviço>@sha256:<digest>` no resumo da execução. A tag `sha-<commit>` serve apenas para localizar a imagem, **não** deve ser usada pelo receptor para garantir imutabilidade. Não instala nem ativa container algum na VPS.
3. Antes de trocar o transporte existente, projetar e testar **receptor SSH v3** que: usa conta de leitura de GHCR separada e com escopo mínimo; baixa imagens por digest SHA-256, verifica identidade/labels/SHA, prepara os dois serviços antes de ativar, verifica `/health`, mantém a revisão anterior e oferece rollback. Credenciais não devem passar em logs, argumentos de processo ou `docker config.json` de uso geral.
4. Testar primeiro num fluxo isolado. Manter o receptor v2 (rsync) como mecanismo de recuperação até 2 deploys e 1 rollback por digest validados. Não modificar o Caddy/softload-wake nessa etapa. O Caddy atualmente aponta diretamente ao App como recuperação emergencial do HTTP 503; não sobrescrever essa regra.
5. Só habilitar o push-to-GHCR + pull-from-VPS automático depois dos testes e da configuração administrativa no host.

O Painel possui funcionalidades opcionais de GHCR para **apps gerenciados pelo Painel**. Elas não implicam que o receptor SSH da Softload V4 já suporte pull/digest ou que a VPS possua credenciais GHCR.

**Nota:** o repositório de código é público. Nunca enviar uma imagem da aplicação a um pacote público sem auditar seu conteúdo. O bootstrap deliberadamente publica somente uma imagem inerte para verificar a visibilidade. O GHCR também pode cobrar armazenamento/tráfego conforme o plano e a política aplicável.

Documentação: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
