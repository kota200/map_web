#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse
import os

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.wasm'):
            return 'application/wasm'
        if path.endswith('.mjs'):
            return 'text/javascript'
        return super().guess_type(path)

parser = argparse.ArgumentParser(description='Serve kallisto Web with pthread isolation headers.')
parser.add_argument('--bind', default='127.0.0.1')
parser.add_argument('--port', type=int, default=8000)
args = parser.parse_args()

print(f'Serving kallisto Web at http://{args.bind}:{args.port}/')
ThreadingHTTPServer((args.bind, args.port), Handler).serve_forever()
