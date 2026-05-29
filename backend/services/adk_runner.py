"""
ADK agent runner — wraps the root_agent in a stateful session runner.
Used by the /interview endpoint when ADK_ENABLED=true.
Falls back to Flow 1 (OpenAI) automatically on any failure.
"""
import asyncio
import logging
import threading

logger = logging.getLogger(__name__)

try:
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai.types import Content, Part
    from agent.report_factory_agent.agent import root_agent

    _session_service = InMemorySessionService()
    _runner = Runner(
        agent=root_agent,
        app_name="report_factory",
        session_service=_session_service,
    )
    _available = True
except Exception as e:
    logger.warning(f"ADK runner failed to initialise: {e}. Flow 1 fallback will be used.")
    _available = False

_sessions: set = set()
_session_lock = threading.Lock()


def _create_session(session_id: str) -> None:
    """Create ADK session synchronously. ADK 2.x requires explicit session creation."""
    async def _create():
        await _session_service.create_session(
            app_name="report_factory",
            user_id="default",
            session_id=session_id,
        )
    asyncio.run(_create())


def run_turn(session_id: str, user_message: str) -> str:
    """
    Run one ADK agent turn and return the agent's text response.
    Creates session on first call per session_id.
    Raises RuntimeError if ADK is unavailable or the turn fails — caller falls back to Flow 1.
    """
    if not _available:
        raise RuntimeError("ADK runner not available")

    # Create session on first use (ADK 2.x does not auto-create sessions)
    with _session_lock:
        if session_id not in _sessions:
            _create_session(session_id)
            _sessions.add(session_id)

    content = Content(role="user", parts=[Part(text=user_message or "hello")])
    response_text = ""

    for event in _runner.run(
        user_id="default",
        session_id=session_id,
        new_message=content,
    ):
        if event.is_final_response() and event.content:
            for part in event.content.parts:
                if hasattr(part, "text") and part.text:
                    response_text += part.text

    if not response_text:
        raise RuntimeError("ADK returned empty response")

    return response_text.strip()
