# Limpeza controlada de staging na VPS

O inventario de 28/10/2026 encontrou aproximadamente 929 MB em
arquivos softload-app-<SHA>.tar.gz em /var/lib/softload-image-staging.
Sao pacotes de transporte, nao imagens importadas no containerd.

## Limites da limpeza

- cleanup_staging.py aceita SOMENTE arquivos regulares do diretorio de staging
  com o formato softload-(app|agent)-<40 digitos hexadecimais>.tar.gz.
- Nao toca em links simbolicos, pastas, imagens Docker, containers, volumes,
  bancos de dados, backups ou /var/lib/containerd.
- O padrao e somente leitura; --apply exige root e --confirm-idle.
- O lock do receptor ajuda, mas nao garante que o rsync esteja parado durante
  toda a transferencia. Verifique os GitHub Actions e os processos do host
  ANTES de confirmar que nao existe deploy ativo.
- Por padrao, arquivos modificados nas ultimas 24 horas ficam preservados.
  Para limpeza imediata use --min-age-hours 0 apos verificar inatividade.
- O utilitario torna impossivel retomar arquivos de transferencias excluidos.

## Uso no Terminal VPS administrativo

Execute a copia revisada na VPS. Apenas conectar GitHub nao executa comandos
administrativos no host. Exemplo, a partir de um checkout do repositorio:

    python3 scripts/vps/cleanup_staging.py --min-age-hours 0

Apos confirmar que nao ha deploy nem transferencia ativa:

    python3 scripts/vps/cleanup_staging.py --apply --confirm-idle --min-age-hours 0
    du -sh /var/lib/softload-image-staging
    df -h /

Para consultar as imagens sem alterar nada:

    docker system df -v
    docker image ls --digests

O Docker informou 9 imagens ativas e 0 B recuperaveis em 28/10/2026.
Camadas utilizadas por containers em execucao NAO sao cache dispensavel.
Nao apagar manualmente /var/lib/containerd, nem executar docker system
prune --volumes. Remova apenas imagens realmente sem referencias, por ID.

## Evitar acumulacao futura

### Receptor sincronizado (issue #72)

O fonte revisável é `scripts/vps/softload-actions-receiver.sh`. As operações
rsync/finish/reuse/deploy compartilham a mesma trava usada por cleanup_staging.
O shell pai mantém a trava até o rsync terminar. Uma repetição de finish para
imagem já importada também valida e remove o pacote recebido. Depois de saúde
confirmada, somente tags App/Agent sem referência por containers são removidas;
nenhuma limpeza global de imagens de outros projetos é feita pelo receptor.

`scripts/vps/softload-clean-stale-archives.sh` substitui o find/delete sem trava:
se houver rsync ou Runner.Worker, não limpa. Caso contrário, executa o utilitário
de staging com trava exclusiva e nomes exatos, removendo pacotes abandonados.
O timer existente pode continuar chamando esse wrapper. Os testes de retenção
simulam Docker e transferência em diretórios temporários.

Política solicitada: não criar cópia anterior do receptor/código nem manter
imagens de rollback depois de deploy saudável. A substituição do executável
deve ser atômica, após checksum, bash -n, handshake e confirmação de ociosidade.
Recuperação de código ocorre pelo GitHub e rebuild/redeploy; dados, segredos,
volumes, certificados e configuração operacional continuam preservados.
O migrador histórico `migrate_receiver_v2.py` cria backup local e não deve ser
usado nessa política. Não executar limpeza enquanto houver deploy em trânsito.

O receptor SSH que recebe os pacotes é instalado fora do checkout.
Uma limpeza automatica apos o deploy exige uma alteracao coordenada no
receptor real, incluindo lock, validacao de revisao/transferencias em curso
e testes de regressao. O runner softloadrunner nao possui Docker/sudo;
nao elevar privilegios somente para fazer essa limpeza. Este PR nao
instala cron, nem deleta nada automaticamente.
