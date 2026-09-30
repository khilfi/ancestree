from fastapi import APIRouter

from ancestree.domain.dates import DateParseError, describe_partial_date, parse_partial_date
from ancestree.domain.views import DateReading

router = APIRouter(prefix="/dates", tags=["people"])


@router.get("/read")
async def read_date(text: str) -> DateReading:
    """How a typed date is understood, for the live preview under date fields."""
    try:
        date = parse_partial_date(text)
    except DateParseError as error:
        return DateReading(text=text, date=None, description=None, error=str(error))
    description = describe_partial_date(date) if date else None
    return DateReading(text=text, date=date, description=description, error=None)
