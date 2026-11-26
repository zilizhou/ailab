"""Server-side client for providers with a Chat Completions endpoint."""
import asyncio
import base64
import os
from dataclasses import dataclass, field
from typing import Optional, Union

import httpx


@dataclass(frozen=True)
class ModelConfig:
    base_url: str
    model: str
    api_key: str = field(repr=False)

    @classmethod
    def from_env(cls, model_var: str = 'LAB_AI_MODEL') -> Optional['ModelConfig']:
        key = os.getenv('LAB_AI_KEY', '').strip()
        model = os.getenv(model_var, '').strip()
        if not key or not model:
            return None
        base = os.getenv('LAB_AI_BASE_URL', 'https://api.openai.com/v1').strip().rstrip('/')
        return cls(base, model, key)


async def complete(config: ModelConfig, system: str, prompt: Union[str, list[dict]], *,
                   max_tokens: int = 1200, timeout: int = 20) -> str:
    payload = {
        'model': config.model,
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}],
        'max_tokens': max_tokens,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(config.base_url + '/chat/completions',
                                     headers={'Authorization': 'Bearer ' + config.api_key}, json=payload)
        response.raise_for_status()
    try:
        answer = response.json()['choices'][0]['message']['content']
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ValueError('Model response did not have the expected format') from exc
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError('Model returned no text')
    return answer.strip()


def visual_prompt(content: bytes, mime: str, text: str) -> list[dict]:
    kind = 'video_url' if mime == 'video/mp4' else 'image_url'
    url = 'data:' + mime + ';base64,' + base64.b64encode(content).decode('ascii')
    return [{'type': kind, kind: {'url': url}}, {'type': 'text', 'text': text}]


def check_connection() -> int:
    config = ModelConfig.from_env()
    if config is None:
        print('未配置模型。请检查服务端 LAB_AI_MODEL 和 LAB_AI_KEY。')
        return 2
    try:
        asyncio.run(complete(config, '这是一条服务连通性测试。', '请用中文简短回答：实验助教可以开始了吗？', max_tokens=64))
    except httpx.HTTPStatusError as exc:
        print(f'模型连接失败（HTTP {exc.response.status_code}）。请核对地域、密钥、模型权限和额度。')
        return 1
    except (httpx.HTTPError, httpx.InvalidURL):
        print('模型网络请求失败。请核对服务地址并检查服务器网络。')
        return 1
    except ValueError:
        print('模型未返回可用文本。请核对接口类型和模型配置。')
        return 1
    print('模型连接成功，已收到文本答复。')
    return 0


if __name__ == '__main__':
    raise SystemExit(check_connection())
