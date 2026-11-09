import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status

from app import crud
from app.api.deps import SessionDep
from app.models import DocumentCreate, DocumentOut, DocumentUpdate

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