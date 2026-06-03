"""
Shared LLM access layer for the intake pipeline.

Every model/skill-based stage (classification, extraction, rules, routing)
goes through this module so there is ONE place that knows how to reach the
model.  When OPENAI_API_KEY is absent the pipeline stages fall back to their
legacy deterministic implementations (which remain in the codebase but
dormant) so the application never hard-crashes.

Configuration (env vars):
  OPENAI_API_KEY   secret — when absent, gpt_available() is False
  OPENAI_BASE_URL  Azure AI Foundry / OpenAI-compatible endpoint
                   e.g. https://<resource>.services.ai.azure.com/openai/v1
  GPT_MODEL        deployment / model name (default "gpt-4.1")
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL: str = os.environ.get("OPENAI_BASE_URL", "")
GPT_MODEL: str = os.environ.get("GPT_MODEL", "gpt-4.1")


def gpt_available() -> bool:
    """True when an API key is present — gates the model/skill path."""
    return bool(OPENAI_API_KEY)


def make_client():
    """
    Build an OpenAI SDK client.  Uses OPENAI_BASE_URL when set (Azure AI
    Foundry or any OpenAI-compatible gateway); otherwise talks to OpenAI.
    """
    from openai import OpenAI
    if OPENAI_BASE_URL:
        return OpenAI(base_url=OPENAI_BASE_URL, api_key=OPENAI_API_KEY)
    return OpenAI(api_key=OPENAI_API_KEY)


def chat_json(
    system_msg: str,
    user_msg: str,
    max_tokens: int = 1500,
) -> Optional[Dict[str, Any]]:
    """
    Single JSON-mode chat completion.  Returns the parsed JSON object, or None
    on any failure so the caller can fall back to its legacy path.
    """
    if not gpt_available():
        return None
    try:
        client = make_client()
        resp = client.chat.completions.create(
            model=GPT_MODEL,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=max_tokens,
        )
        return json.loads(resp.choices[0].message.content)
    except Exception:
        return None
