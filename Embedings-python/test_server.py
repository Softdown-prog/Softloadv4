"""Testes do serviço de embeddings -- nunca carregam o modelo local de
verdade (embed_texts é sempre substituído por um fake), então rodam
rápido, sem baixar/rodar o modelo ONNX e sem custo de CPU."""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def app_module(monkeypatch):
    monkeypatch.setenv("EMBEDDINGS_SHARED_SECRET", "test-secret")
    import server  # noqa: PLC0415
    importlib.reload(server)
    return server


@pytest.fixture()
def client(app_module):
    app_module.app.testing = True
    return app_module.app.test_client()


def test_health_nao_exige_autenticacao(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok"}


def test_embed_exige_autenticacao(client):
    resp = client.post("/embed", json={"texts": ["ola"]})
    assert resp.status_code == 401


def test_embed_rejeita_segredo_errado(client):
    resp = client.post(
        "/embed",
        json={"texts": ["ola"]},
        headers={"x-embeddings-secret": "segredo-errado"},
    )
    assert resp.status_code == 401


def test_embed_sucesso(app_module, client, monkeypatch):
    def fake_embed_texts(texts, task_type):
        assert task_type == "RETRIEVAL_DOCUMENT"
        return [[0.1, 0.2, 0.3] for _ in texts]

    monkeypatch.setattr(app_module, "embed_texts", fake_embed_texts)

    resp = client.post(
        "/embed",
        json={"texts": ["primeiro chunk", "segundo chunk"]},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["embeddings"] == [[0.1, 0.2, 0.3], [0.1, 0.2, 0.3]]
    assert data["model"] == app_module.EMBEDDING_MODEL
    assert data["dimension"] == app_module.EMBEDDING_DIMENSION


def test_embed_default_task_type_e_retrieval_document(app_module, client, monkeypatch):
    chamadas = []

    def fake_embed_texts(texts, task_type):
        chamadas.append(task_type)
        return [[0.0] for _ in texts]

    monkeypatch.setattr(app_module, "embed_texts", fake_embed_texts)

    client.post(
        "/embed",
        json={"texts": ["ola"]},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert chamadas == ["RETRIEVAL_DOCUMENT"]


def test_embed_aceita_retrieval_query(app_module, client, monkeypatch):
    chamadas = []
    monkeypatch.setattr(app_module, "embed_texts", lambda texts, task_type: chamadas.append(task_type) or [[0.0]])

    client.post(
        "/embed",
        json={"texts": ["busca"], "taskType": "RETRIEVAL_QUERY"},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert chamadas == ["RETRIEVAL_QUERY"]


def test_embed_rejeita_task_type_invalido(app_module, client):
    resp = client.post(
        "/embed",
        json={"texts": ["ola"], "taskType": "INVALIDO"},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 400


def test_embed_rejeita_lista_vazia(app_module, client):
    resp = client.post(
        "/embed",
        json={"texts": []},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 400


def test_embed_rejeita_corpo_sem_texts(app_module, client):
    resp = client.post(
        "/embed",
        json={},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 400


def test_embed_rejeita_entrada_nao_string(app_module, client):
    resp = client.post(
        "/embed",
        json={"texts": ["ola", 123]},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 400


def test_embed_rejeita_entrada_vazia_apos_strip(app_module, client):
    resp = client.post(
        "/embed",
        json={"texts": ["   "]},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 400


def test_embed_rejeita_texto_acima_do_limite_de_palavras(app_module, client):
    texto_grande = " ".join(["palavra"] * (app_module.MAX_WORDS_PER_TEXT + 1))
    resp = client.post(
        "/embed",
        json={"texts": [texto_grande]},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 400
    assert str(app_module.MAX_WORDS_PER_TEXT) in resp.get_json()["error"]


def test_embed_aceita_texto_exatamente_no_limite(app_module, client, monkeypatch):
    monkeypatch.setattr(app_module, "embed_texts", lambda texts, task_type: [[0.0] for _ in texts])
    texto_no_limite = " ".join(["palavra"] * app_module.MAX_WORDS_PER_TEXT)
    resp = client.post(
        "/embed",
        json={"texts": [texto_no_limite]},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 200


def test_embed_rejeita_excesso_de_textos_por_requisicao(app_module, client, monkeypatch):
    monkeypatch.setattr(app_module, "MAX_TEXTS_PER_REQUEST", 2)
    resp = client.post(
        "/embed",
        json={"texts": ["a", "b", "c"]},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 400


def test_embed_sem_segredo_configurado_aceita_qualquer_chamador(monkeypatch):
    monkeypatch.delenv("EMBEDDINGS_SHARED_SECRET", raising=False)
    import server  # noqa: PLC0415
    importlib.reload(server)
    server.app.testing = True
    client = server.app.test_client()
    monkeypatch.setattr(server, "embed_texts", lambda texts, task_type: [[0.0] for _ in texts])

    resp = client.post("/embed", json={"texts": ["ola"]})
    assert resp.status_code == 200


def test_embed_propaga_falha_de_inferencia_como_500(app_module, client, monkeypatch):
    # Modelo local -- não existe mais "API upstream" pra distinguir
    # 500 (config) de 502 (falha remota), como na versão com Gemini.
    # Qualquer falha em embed_texts (modelo corrompido, sem memória
    # etc.) é um erro deste próprio serviço: 500 pra qualquer exceção.
    def fake_embed_texts(texts, task_type):
        raise RuntimeError("modelo não pôde ser carregado")

    monkeypatch.setattr(app_module, "embed_texts", fake_embed_texts)

    resp = client.post(
        "/embed",
        json={"texts": ["ola"]},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 500


def test_embed_propaga_qualquer_excecao_como_500(app_module, client, monkeypatch):
    def fake_embed_texts(texts, task_type):
        raise ValueError("boom")

    monkeypatch.setattr(app_module, "embed_texts", fake_embed_texts)

    resp = client.post(
        "/embed",
        json={"texts": ["ola"]},
        headers={"x-embeddings-secret": "test-secret"},
    )
    assert resp.status_code == 500
