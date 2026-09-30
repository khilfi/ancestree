"""Reading a spreadsheet saved as CSV, however Excel saved it.

Excel's "CSV UTF-8" starts with a byte-order mark; its plain "CSV" uses the Windows code
page; "Unicode Text" is UTF-16. Commas separate the cells, or semicolons where Excel's
settings use a decimal comma, or tabs. Rows are numbered as Excel numbers them, the column
names being row 1, so "row 7" in a report is row 7 on screen.
"""

import csv
import io
from dataclasses import dataclass

from ancestree.exchange.spreadsheet import COLUMNS, unguard

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 20_000

# The columns an import reads: the spreadsheet export's, but for what only an export says.
PASSED_OVER = ("Photo", "Story (words)", "Sources")
READ = tuple(column for column in COLUMNS if column not in PASSED_OVER)


class SheetError(Exception):
    """The file can't be read as a spreadsheet at all; nothing was imported (HTTP 422)."""


@dataclass(frozen=True)
class SheetRow:
    number: int  # as Excel numbers it: the column names are row 1
    cells: dict[str, str]  # by column (READ's names), stripped; "" when empty or missing

    def __getitem__(self, column: str) -> str:
        return self.cells.get(column, "")


@dataclass(frozen=True)
class Sheet:
    rows: list[SheetRow]
    not_read: list[str]  # column names that aren't the import's
    # The import's columns the file has. A column taken out of the file says nothing: its
    # empty cells aren't taken for values cleared.
    columns: frozenset[str] = frozenset(READ)


def _decode(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        # Excel's plain "CSV" on Windows. Five bytes have no character in cp1252; Latin-1
        # reads anything, so the file is never refused for its encoding alone.
        try:
            return data.decode("cp1252")
        except UnicodeDecodeError:
            return data.decode("latin-1")


def _delimiter(text: str) -> str:
    """Commas, semicolons or tabs: whichever the first line has most of, outside quotes."""
    counts = {",": 0, ";": 0, "\t": 0}
    quoted = False
    for char in text:
        if char == '"':
            quoted = not quoted
        elif char in "\r\n" and not quoted:
            if any(counts.values()):
                break
        elif char in counts and not quoted:
            counts[char] += 1
    return max(counts, key=lambda d: (counts[d], d == ","))


def _key(name: str) -> str:
    return " ".join(name.split()).casefold()


_KNOWN = {_key(column): column for column in (*READ, *PASSED_OVER)}


def read_sheet(data: bytes) -> Sheet:
    if len(data) > MAX_BYTES:
        raise SheetError("The file is bigger than 5 MB, too big for a spreadsheet of people.")
    text = _decode(data).replace("\x00", "")
    if not text.strip():
        raise SheetError("The file is empty.")
    records = list(csv.reader(io.StringIO(text, newline=""), delimiter=_delimiter(text)))

    header_at = next((i for i, record in enumerate(records) if any(c.strip() for c in record)), 0)
    positions: dict[str, int] = {}
    not_read: list[str] = []
    for position, name in enumerate(records[header_at]):
        column = _KNOWN.get(_key(name))
        if column is None or column in positions:
            if name.strip():
                not_read.append(" ".join(name.split()))
        elif column not in PASSED_OVER:
            positions[column] = position
    if "Full name" not in positions:
        raise SheetError(
            "The first row needs the column names, with one called 'Full name'. "
            "Download the template to see them all."
        )

    rows: list[SheetRow] = []
    for index in range(header_at + 1, len(records)):
        record = records[index]
        cells = {
            column: unguard(record[position].strip()) if position < len(record) else ""
            for column, position in positions.items()
        }
        if any(cells.values()):
            rows.append(SheetRow(number=index + 1, cells=cells))
    if len(rows) > MAX_ROWS:
        raise SheetError(f"The file has more than {MAX_ROWS:,} rows, too many for one import.")
    return Sheet(rows=rows, not_read=not_read, columns=frozenset(positions))
