"""
MorPex Embedding Server — BGE-M3 向量嵌入服务

提供 HTTP API:
  POST /embed    — 文本 → 向量 (返回 float[])
  POST /embed-batch — 批量文本 → 向量[]
  GET  /health   — 健康检查
  GET  /info     — 模型信息

启动:
  python embedding-server.py --model-path ../data/models/bge-m3 --port 3100

依赖:
  pip install sentence-transformers torch transformers
"""

import argparse
import json
import os
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

import numpy as np

# 延迟加载模型
model = None


def load_model(model_path: str):
    global model
    import sys
    sys.stdout.write(f"[Embedding] Loading model: {model_path}\n")
    sys.stdout.flush()
    t0 = time.time()
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(model_path, device='cpu')
    dim = model.get_embedding_dimension()
    elapsed = time.time() - t0
    sys.stdout.write(f"[Embedding] Model loaded in {elapsed:.1f}s, dim={dim}\n")
    sys.stdout.flush()


def embed_text(text: str) -> list:
    emb = model.encode(text, normalize_embeddings=True)
    return emb.tolist()


def embed_batch(texts: list[str]) -> list[list[float]]:
    embs = model.encode(texts, normalize_embeddings=True)
    return embs.tolist()


class EmbeddingHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/health':
            ok = model is not None
            self._json(200, {"ok": ok, "model_loaded": ok})
        elif path == '/info':
            dim = model.get_embedding_dimension() if model else 0
            self._json(200, {
                "ok": True,
                "model": "BGE-M3",
                "dimension": dim,
                "device": "cpu",
            })
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if model is None:
            self._json(503, {"error": "model not loaded"})
            return

        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length)) if length > 0 else {}
        except Exception as e:
            self._json(400, {"error": f"invalid json: {e}"})
            return

        if path == '/embed':
            text = body.get('text', '')
            if not text:
                self._json(400, {"error": "missing text"})
                return
            t0 = time.time()
            vec = embed_text(text)
            self._json(200, {
                "ok": True,
                "vector": vec,
                "dimension": len(vec),
                "duration_ms": round((time.time() - t0) * 1000),
            })

        elif path == '/embed-batch':
            texts = body.get('texts', [])
            if not texts or not isinstance(texts, list):
                self._json(400, {"error": "missing texts array"})
                return
            t0 = time.time()
            vecs = embed_batch(texts)
            self._json(200, {
                "ok": True,
                "vectors": vecs,
                "dimension": len(vecs[0]) if vecs else 0,
                "count": len(vecs),
                "duration_ms": round((time.time() - t0) * 1000),
            })
        else:
            self._json(404, {"error": "not found"})

    def _json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def log_message(self, format, *args):
        if '/health' not in args[0]:
            super().log_message(format, *args)


def main():
    parser = argparse.ArgumentParser(description='MorPex BGE-M3 Embedding Server')
    parser.add_argument('--model-path', default='../data/models/bge-m3',
                        help='BGE-M3 模型路径')
    parser.add_argument('--port', type=int, default=3100,
                        help='服务端口')
    parser.add_argument('--mode', choices=['http'], default='http',
                        help='运行模式')
    args = parser.parse_args()

    model_path = os.path.abspath(args.model_path)
    if not os.path.exists(model_path):
        print(f"[Embedding] 错误: 模型路径不存在: {model_path}")
        sys.exit(1)

    print(f"[Embedding] MorPex BGE-M3 Embedding Server")
    print(f"[Embedding] 端口: {args.port}")
    print(f"[Embedding] 模型: {model_path}")

    load_model(model_path)

    server = HTTPServer(('0.0.0.0', args.port), EmbeddingHandler)
    print(f"[Embedding] 服务运行在 http://0.0.0.0:{args.port}")
    print(f"[Embedding] POST /embed — 文本 → 向量")
    print(f"[Embedding] POST /embed-batch — 批量文本 → 向量[]")
    print(f"[Embedding] GET  /health — 健康检查")
    print(f"[Embedding] GET  /info — 模型信息")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Embedding] 关闭服务...")
        server.shutdown()


if __name__ == '__main__':
    main()
