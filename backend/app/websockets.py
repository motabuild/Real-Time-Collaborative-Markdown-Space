import asyncio
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Tracks active WebSocket connections grouped by document room.

    Every connection is keyed by the document id as a *string* so that
    ``uuid.UUID`` objects and raw path parameters always resolve to the same
    room. Callers may pass either; normalization happens here.
    """

    def __init__(self) -> None:
        self.active_connections: dict[str, list[WebSocket]] = {}

    @staticmethod
    def _room_key(document_id: str | object) -> str:
        """Normalize any document identifier to the canonical room key."""
        return str(document_id)

    async def connect(self, websocket: WebSocket, document_id: str) -> None:
        """Accept the connection and add it to the document room."""
        await websocket.accept()
        key = self._room_key(document_id)
        self.active_connections.setdefault(key, []).append(websocket)
        logger.debug(
            "WebSocket connected to room %s (%d peer(s))",
            key,
            len(self.active_connections[key]),
        )

    def disconnect(self, websocket: WebSocket, document_id: str) -> None:
        """
        Remove the connection from the room.

        Safe to call more than once, or for a socket that was never registered,
        so cleanup code can run defensively. Empty rooms are dropped to avoid
        leaking dictionary entries over the lifetime of the process.
        """
        key = self._room_key(document_id)
        room = self.active_connections.get(key)
        if room is None:
            return
        if websocket in room:
            room.remove(websocket)
        if room:
            logger.debug(
                "WebSocket disconnected from room %s (%d peer(s) left)",
                key,
                len(room),
            )
        else:
            self.active_connections.pop(key, None)

    def peer_count(self, document_id: str) -> int:
        """Return the number of peers currently in a room."""
        return len(self.active_connections.get(self._room_key(document_id), []))

    async def broadcast(self, document_id: str, message: dict[str, Any]) -> None:
        """
        Send ``message`` as JSON to every socket in the room.

        Sends run concurrently and individually guarded: a single broken or
        closed peer must not abort delivery to the rest of the room. Any socket
        that fails to receive is removed from the room.
        """
        key = self._room_key(document_id)
        room = list(self.active_connections.get(key, []))
        if not room:
            return

        results = await asyncio.gather(
            *(websocket.send_json(message) for websocket in room),
            return_exceptions=True,
        )

        stale: list[WebSocket] = []
        for websocket, result in zip(room, results, strict=True):
            if isinstance(result, BaseException):
                logger.warning("Dropping unreachable WebSocket in room %s", key)
                stale.append(websocket)

        for websocket in stale:
            self.disconnect(websocket, key)


manager = ConnectionManager()
