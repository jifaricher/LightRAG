"""
TEI (Text Embeddings Inference) to Cohere rerank API proxy.

HuggingFace TEI's /rerank endpoint uses `texts` field, while LightRAG's
cohere binding sends `documents`. This proxy translates between the two.

Usage:
    python tei_rerank_proxy.py --tei-host http://192.168.1.7:8000 --port 8001

Then configure .env:
    RERANK_BINDING=cohere
    RERANK_MODEL=BAAI/bge-reranker-v2-m3
    RERANK_BINDING_HOST=http://localhost:8001/rerank
    RERANK_BINDING_API_KEY=any
"""

import argparse
import json
import logging
import sys
from urllib.request import Request, urlopen
from urllib.error import URLError
from http.server import HTTPServer, BaseHTTPRequestHandler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("tei-proxy")


class TEIRerankProxy(BaseHTTPRequestHandler):
    tei_host = "http://localhost:8000"

    def do_POST(self):
        if self.path != "/rerank":
            self._json_error(404, "Not Found")
            return

        try:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        except (json.JSONDecodeError, KeyError):
            self._json_error(400, "Invalid JSON body")
            return

        # Translate Cohere format -> TEI format
        tei_payload = {
            "query": body.get("query", ""),
            "texts": body.get("documents", []),
        }
        if "top_n" in body:
            tei_payload["top_n"] = body["top_n"]

        try:
            req = Request(
                f"{self.tei_host}/rerank",
                data=json.dumps(tei_payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(req, timeout=60) as resp:
                tei_result = json.loads(resp.read())
        except URLError as e:
            logger.error("TEI request failed: %s", e)
            self._json_error(502, f"TEI backend error: {e}")
            return

        # Translate TEI response -> Cohere format
        cohere_result = [
            {"index": item["index"], "relevance_score": item["score"]}
            for item in tei_result
        ]

        self._json_response({"results": cohere_result})

    def do_GET(self):
        if self.path == "/health":
            self._json_response({"status": "ok"})
        else:
            self._json_response({"service": "tei-rerank-proxy", "endpoints": ["/rerank"]})

    def _json_response(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json_error(self, code, message):
        self._json_response({"detail": message}, code)

    def log_message(self, fmt, *args):
        logger.info("%s - %s", self.address_string(), fmt % args)


def main():
    parser = argparse.ArgumentParser(description="TEI to Cohere rerank proxy")
    parser.add_argument("--tei-host", required=True, help="TEI service URL")
    parser.add_argument("--port", type=int, default=8001, help="Proxy listen port")
    parser.add_argument("--host", default="0.0.0.0", help="Proxy listen host")
    args = parser.parse_args()

    TEIRerankProxy.tei_host = args.tei_host.rstrip("/")
    server = HTTPServer((args.host, args.port), TEIRerankProxy)
    logger.info("TEI rerank proxy: %s -> %s/rerank", args.tei_host, args.host)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down")
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
