"""Forgejo HTTP client: auth, retry/backoff, error classification."""

import json
import os
import random
import sys
import time
import logging
import urllib.request
import urllib.error
from urllib.parse import urlencode
from typing import Optional

import config
from config import FORGEJO

logger = logging.getLogger(__name__)


class ForgejoError(Exception):
    def __init__(self, message: str, kind: str = "other", code: Optional[int] = None, body: str = ""):
        super().__init__(message)
        self.kind = kind  # auth | notfound | network | server | other
        self.code = code
        self.body = body


def get_forgejo_token() -> str:
    return os.environ.get(FORGEJO["token_env"], "")


def forgejo_request(method: str, endpoint: str, params: Optional[dict] = None,
                    json_body: Optional[dict] = None, retries: int = 3):
    """Perform an authenticated request with retry/backoff on transient errors."""
    token = get_forgejo_token()
    if not token:
        raise ForgejoError("FORGEJO_TOKEN not set", kind="auth")

    url = f"{FORGEJO['api_base']}{endpoint}"
    if params:
        url = f"{url}?{urlencode(params)}"

    headers = {"Authorization": f"token {token}", "Accept": "application/json"}
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"

    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode(errors="ignore")
            except Exception:
                pass
            if e.code in (401, 403):
                raise ForgejoError(f"Authentication failed ({e.code})", kind="auth", code=e.code, body=body)
            if e.code == 404:
                raise ForgejoError("Not found", kind="notfound", code=e.code, body=body)
            if 500 <= e.code < 600:
                last_exc = ForgejoError(f"Server error {e.code}", kind="server", code=e.code, body=body)
            else:
                raise ForgejoError(f"HTTP {e.code}", kind="other", code=e.code, body=body)
        except urllib.error.URLError as e:
            last_exc = ForgejoError(f"Network error: {e.reason}", kind="network")
        except Exception as e:
            raise ForgejoError(f"Request failed: {e}", kind="other")

        # Exponential backoff with jitter before retrying transient errors.
        time.sleep(min(2 ** attempt, 10) + random.uniform(0, 0.5))

    raise last_exc  # type: ignore[misc]


def fj_get(endpoint: str, params: Optional[dict] = None):
    return forgejo_request("GET", endpoint, params=params)


def fj_post(endpoint: str, json_body: Optional[dict] = None):
    return forgejo_request("POST", endpoint, json_body=json_body)


def fj_patch(endpoint: str, json_body: Optional[dict] = None):
    return forgejo_request("PATCH", endpoint, json_body=json_body)


def fj_delete(endpoint: str):
    return forgejo_request("DELETE", endpoint)


def validate_token() -> str:
    """Authenticate once at startup; abort early on failure. Returns bot login."""
    try:
        me = fj_get("/user")
        login = me.get("login", "unknown") if isinstance(me, dict) else "unknown"
        logger.info(f"Authenticated with Forgejo as '{login}'")
        config.BOT_LOGIN = login
        return login
    except ForgejoError as e:
        logger.error(f"Forgejo authentication failed: {e}")
        logger.error("Check that FORGEJO_TOKEN is set and valid.")
        sys.exit(1)
