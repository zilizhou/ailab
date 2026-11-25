"""Small launcher; .env is read as literal key/value pairs, never executed as shell code."""
import os
from pathlib import Path

root = Path(__file__).resolve().parent
env = root / '.env'
if env.exists():
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key.strip().startswith('LAB_'):
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))

if __name__ == '__main__':
    import uvicorn
    bind_host = os.environ.get('LAB_HOST', '127.0.0.1')
    bind_port = int(os.environ.get('LAB_PORT', '8765'))
    print(f'知实验启动地址：http://{bind_host}:{bind_port} 。按 Control+C 停止。')
    uvicorn.run('server:app', host=bind_host, port=bind_port, app_dir=str(root))
