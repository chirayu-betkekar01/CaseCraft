"""The only module in this repository that makes a network call.

Routed through OpenRouter rather than Anthropic directly, since that is the
credential this deployment has. OpenRouter speaks the OpenAI-compatible chat
completions schema, not Anthropic's native Messages API, so this goes through
the `openai` SDK pointed at OpenRouter's base URL — the model behind it is
still Claude; only the wire format and the SDK differ.

This file is one function wide on purpose. Everything that can be checked
without an API key — prompt assembly, quote verification, the sanitizer —
lives in transcript.py, and this file is what tests replace wholesale.

Vendor-neutral by design: the product is "the Platform", the prior state is
"legacy tools" or "the current environment".
"""

from __future__ import annotations

from transcript import (
    AnalysisUnavailable,
    RawAnalysis,
    build_user_message,
    require_api_key,
)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

MODEL = "anthropic/claude-opus-5"
"""OpenRouter's slug for the model — still Claude Opus 5, addressed through the
provider prefix OpenRouter's catalog uses rather than the bare Anthropic id."""

MAX_TOKENS = 16_000
"""Comfortably above any real answer. A truncated response would fail schema
validation and cost a whole retry, which is worse than the unused headroom."""


def analyze_transcript(transcript: str, system_prompt: str) -> RawAnalysis:
    """Ask which value drivers this call supports. Returns unvalidated output.

    The caller must run sanitize_analysis() on the result. Nothing here is
    trusted — not the driver ids, not the shared input keys, not the quotes.

    The import of the model SDK is deliberately deferred into this function
    rather than sitting at module scope. api.py imports this module when the
    app is constructed, and the test suite builds a TestClient at import time,
    so a top-level import would make the SDK a hard prerequisite for every
    test in the repo — including the deterministic ones that exist precisely to
    prove the financial model needs no LLM. Keeping it here means the cheap
    path carries no LLM dependency even at import time.
    """
    api_key = require_api_key()

    import openai
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)

    try:
        response = client.beta.chat.completions.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": build_user_message(transcript)},
            ],
            response_format=RawAnalysis,
        )
    except openai.AuthenticationError as error:
        raise AnalysisUnavailable(
            "The configured API key was rejected. Check OPENROUTER_API_KEY."
        ) from error
    except openai.RateLimitError as error:
        raise AnalysisUnavailable(
            "Rate limited while analyzing the call. Try again in a moment."
        ) from error
    except openai.APIConnectionError as error:
        raise AnalysisUnavailable(
            "Could not reach the model API. Check the network connection."
        ) from error
    except openai.APIStatusError as error:
        raise AnalysisUnavailable(
            f"The model API returned an error ({error.status_code})."
        ) from error

    parsed = response.choices[0].message.parsed
    if parsed is None:
        # The model refused or returned something the schema could not parse.
        # Neither is a bug in this code, and neither is worth a stack trace.
        raise AnalysisUnavailable("The model did not return a usable analysis.")
    return parsed
