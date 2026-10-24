# Perfis de imagem Docker do sandbox Solaris

## Qual problema estamos resolvendo

O Chromium é **instalado durante o `docker build`**, não está versionado no
repositório GitHub. Por isso a soma de arquivos rastreados pelo Git **não mede**
o tamanho do navegador. O serviço `sandbox-efemoro` acumula duas funções:

- `POST /run`: auditorias de navegador com Playwright (capturas de tela,
  console, responsividade, acessibilidade).
- `POST /extract-zip` e `POST /extract-archive`: extração isolada de
  ZIP, RAR, 7z e TAR.

Uma extração de arquivo não necessita iniciar Chromium. O servidor de
navegador atual já é *lazy*: lança browser apenas quando recebe `/run`
e fecha o processo ao concluir. Só desligar a execução ociosa não reduz
o tamanho da imagem em disco.

## Perfis disponíveis

**Padrão — completo (produção atual):**

```bash
docker build -f sandbox-efemoro/Dockerfile -t softload-sandbox:full sandbox-efemoro
```

Mantém `INSTALL_CHROMIUM=1` e todas as funções. O workflow
`.github/workflows/deploy.yml` **permanece neste perfil por padrão**.
A política de isolamento entre Agent e sandbox é preservada.

**Opcional — archive-only (instância dedicada):**

```bash
docker build --build-arg INSTALL_CHROMIUM=0 \
  -f sandbox-efemoro/Dockerfile -t softload-sandbox:archive-only sandbox-efemoro
```

Continua instalando o pacote JS `playwright`, mas **não baixa o binário
Chromium nem suas dependências nativas extras**. Mantém os endpoints de
extração. O endpoint `/run` continua exposto pelo servidor, porém NÃO
funciona sem o navegador instalado; seu uso retorna uma falha de auditoria.
Portanto, **não aponte tráfego de `websandbox.run` para este perfil**.

> Não substituir o sandbox de produção pelo archive-only sem separar as
> rotas de auditoria e de extração no Agent e sem validar essas rotas.
> Isso seria perda de funcionalidade, não otimização transparente.

## Onde ver números reais

O workflow `Deploy Softload VPS` agora informa, nos logs e no resumo do
job de cada serviço:

- tamanho local da imagem Docker (`docker image inspect .Size`);
- bytes do arquivo `docker save | gzip -1` enviado à VPS.

Esses números não são a RAM de processos em uso: RAM exige medições de
`docker stats` / `docker inspect` executadas no host e não foi medida
por estas alterações.

O arquivo `.dockerignore` na raiz exclui `public/dist/` do contexto de
build: o estágio `frontend-build` executa `npm run build` e o estágio
final copia o resultado recém-gerado. Isso não apaga nenhum arquivo do
Git, nem deixa de servir o frontend React.

## Alterações deliberadamente adiadas

As imagens do Visitor Forge 2D não foram removidas: `agent/forge/UPSTREAM.json`
e `agent/forge/verify-source.cjs` conferem hashes individuais dos arquivos
upstream, e os renderizadores podem utilizar recursos adicionais. Antes de
criar uma distribuição runtime reduzida, construir uma lista exata de
recursos referenciados, manter o verificador no estágio de build e executar
todos os testes de renderização em ambas as imagens.

Também não foram removidos Python, ffmpeg, php-cli, ferramentas de build
ou outras dependências do Agent: essas operações pertencem às capacidades
efetivamente oferecidas pelo Solaris Code.
