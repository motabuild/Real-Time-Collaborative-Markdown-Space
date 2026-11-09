import uuid
from typing import Any

from fastapi import (
    APIRouter,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)

from app import crud
from app.api.deps import SessionDep
from app.models import DocumentCreate, DocumentOut, DocumentUpdate
from app.websockets import manager

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def create_document(*, session: SessionDep, document_in: DocumentCreate) -> Any:
    """
    Create new document.
    """
    return crud.create_document(session=session, document_in=document_in)


@router.get("/{document_id}", response_model=DocumentOut)
def read_document(session: SessionDep, document_id: uuid.UUID) -> Any:
    """
    Get document by ID.
    """
    document = crud.get_document(session=session, document_id=document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.patch("/{document_id}", response_model=DocumentOut)
def update_document(
    *, session: SessionDep, document_id: uuid.UUID, document_in: DocumentUpdate
) -> Any:
    """
    Update a document.
    """
    document = crud.get_document(session=session, document_id=document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return crud.update_document(
        session=session, db_document=document, document_in=document_in
    )


@router.websocket("/{document_id}/ws")
async def document_ws(websocket: WebSocket, document_id: str) -> None:
    """
    Real-time collaboration channel for a single document.

    Clients connect to a document "room" and broadcast JSON payloads to every
    other peer in that room. Each outgoing message is enriched with a ``meta``
    object describing the room state (e.g. how many peers are connected).

    ``document_id`` is kept as a raw string and used verbatim as the room key,
    so equivalent UUID spellings never fragment a room.
    """
    await manager.connect(websocket, document_id)

    try:
        while True:
            data = await websocket.receive_json()

            # Enrich the payload with telemetry before relaying it, so every
            # peer receives the same authoritative room snapshot.
            if isinstance(data, dict):
                data["meta"] = {"active_peers": manager.peer_count(document_id)}
            else:
                data = {
                    "payload": data,
                    "meta": {"active_peers": manager.peer_count(document_id)},
                }

            await manager.broadcast(document_id, data)
    except WebSocketDisconnect:
        manager.disconnect(websocket, document_id)
        await manager.broadcast(
            document_id,
            {
                "event": "system",
                "message": "A peer left the document.",
                "meta": {"active_peers": manager.peer_count(document_id)},
            },
        )
