from workers import WorkerEntrypoint, Response
import json

class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = str(request.url)
        path = url.split("?")[0] if "?" in url else url
        
        if path.endswith("/api/system/health"):
            return Response.json({
                "status": "ok",
                "version": "1.0.0",
                "db_binding": "found" if hasattr(self, "env") and hasattr(self.env, "DB") else "not found"
            })
        
        html = f"""
        <html>
        <body>
        <h1>Python Worker Test</h1>
        <p>URL: {url}</p>
        <p>Method: {request.method}</p>
        <p>DB Binding: {'FOUND' if hasattr(self, 'env') and hasattr(self.env, 'DB') else 'NOT FOUND'}</p>
        </body>
        </html>
        """
        return Response(html, headers={"Content-Type": "text/html"})