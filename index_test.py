from workers import WorkerEntrypoint, Response

class Default(WorkerEntrypoint):
    async def fetch(self, request, env=None, ctx=None):
        db_status = "DB binding: NOT FOUND"
        if env is not None:
            if hasattr(env, "DB"):
                db_binding = getattr(env, "DB", None)
                db_status = f"DB binding: FOUND, type={type(db_binding).__name__}"
            elif hasattr(env, "__getitem__"):
                try:
                    db_binding = env["DB"]
                    db_status = f"DB binding: FOUND via __getitem__, type={type(db_binding).__name__}"
                except:
                    pass
        
        html = f"""
        <html>
        <body>
        <h1>Python Worker Test</h1>
        <p>Request URL: {request.url}</p>
        <p>Method: {request.method}</p>
        <p>{db_status}</p>
        </body>
        </html>
        """
        return Response(html, headers={"Content-Type": "text/html"})
