FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Modelo LOCAL (ONNX Runtime via fastembed) -- pesos baixados e
# cacheados AQUI, no build, nunca em runtime. Sem isso, o container em
# produção precisaria de acesso de rede ao Hugging Face Hub no primeiro
# request pra baixar ~1GB de pesos -- ponto de falha frágil (rede
# instável/bloqueada no runtime do Cloud Run) que este projeto evita de
# propósito, mesmo princípio já usado em sandbox-efemoro/Dockerfile
# (que vendoriza o Chromium na imagem em vez de baixar em runtime).
#
# EMBEDDING_MODEL aqui precisa ser o MESMO valor usado como default em
# server.py -- se mudar um, mude o outro (ou passe EMBEDDING_MODEL como
# build-arg/env em ambos, mas o valor final tem que bater: um modelo
# baixado aqui e outro pedido em runtime faria o container tentar
# baixar de novo em produção, reabrindo o problema que este passo
# existe pra evitar).
ENV EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-mpnet-base-v2
ENV FASTEMBED_CACHE_PATH=/app/model_cache
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='${EMBEDDING_MODEL}')"

COPY server.py ./

# Usuário não-root -- este serviço não guarda nenhuma credencial (nem
# mais GEMINI_API_KEY: o modelo é local, sem chamada a API externa
# nenhuma), mas o princípio de menor privilégio continua valendo (mesmo
# padrão de sandbox-efemoro/Dockerfile). chown do cache do modelo é
# necessário -- foi baixado como root, no passo acima.
RUN useradd -r -m embeddings && chown -R embeddings:embeddings /app
USER embeddings

# Cloud Run injeta PORT em runtime.
EXPOSE 8080

# --workers 1 (não vários): cada worker do gunicorn é um PROCESSO
# separado -- com N workers, o modelo (~1GB) seria carregado N vezes na
# memória. Um processo só, com --threads pra concorrência (ONNX Runtime
# não é bloqueado pelo GIL do Python durante a inferência em si, então
# threads ainda paralelizam de verdade aqui).
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 4 --timeout 60 server:app"]
