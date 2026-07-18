import json

from workers import WorkerEntrypoint, Response

class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = str(request.url)
        path = url.split("?")[0]
        
        if path.endswith("/health") or path.endswith("/"):
            body = json.dumps({"status": "ok", "path": path}, ensure_ascii=False)
            return Response(body, status=200, headers={"Content-Type": "application/json; charset=utf-8"})
        
        body = json.dumps({"error": "Not found", "path": path}, ensure_ascii=False)
        return Response(body, status=404, headers={"Content-Type": "application/json; charset=utf-8"})

if __name__ == "__main__":
    from http.server import HTTPServer, BaseHTTPRequestHandler
    
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "path": self.path}).encode())
    
    server = HTTPServer(("0.0.0.0", 5000), Handler)
    print("Serving at http://localhost:5000")
    server.serve_forever()
