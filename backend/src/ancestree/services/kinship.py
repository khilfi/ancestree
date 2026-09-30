"""Finding how two people are related: load the family, ask the
finder, and say it with everyone the answer mentions; in every kinship language, with the
Kinship dictionary, where the words are looked up."""

import asyncio
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from ancestree.domain.kinship import (
    DictionaryRow,
    DictionarySection,
    DictionaryWord,
    KinExplanation,
    KinPerson,
    KinRelation,
    KinshipAnswer,
    KinshipDictionary,
    KinshipLanguage,
    KinshipSettings,
    KinStatement,
    KinWord,
)
from ancestree.domain.person import Gender
from ancestree.domain.relationship import BIOLOGICAL, RelationshipKind, SpouseStatus
from ancestree.kinship import dictionary
from ancestree.kinship.family import Family, Marriage, Member, ParentLink, short_name
from ancestree.kinship.finder import Relation, Statement, relate
from ancestree.kinship.terms import LANGUAGES, TermBook, Titles
from ancestree.repo import kinds as kinds_repo
from ancestree.repo.graph import read_family
from ancestree.services.context import Context, NotFoundError
from ancestree.services.graph import birth_from_row
from ancestree.storage.settings import read_kinship_settings, write_kinship_settings

UNKNOWN_PARENT = "Unknown parent"


async def find_relationship(ctx: Context, a: UUID, b: UUID) -> KinshipAnswer:
    people, links, _ = await read_family(ctx.driver, ctx.database)
    kinds = await _kinds(ctx)
    return answer(people, links, kinds, a, b, await books_for(ctx))


async def kinship_dictionary(ctx: Context) -> KinshipDictionary:
    """Every relation's words in the three languages, as the answers say them."""
    books = await books_for(ctx)
    sections = dictionary.build(books, await _kinds(ctx))
    return KinshipDictionary(
        languages=[KinshipLanguage(code=code, name=books[code].language) for code in LANGUAGES],
        sections=[
            DictionarySection(
                id=section.id,
                title=section.title,
                rows=[
                    DictionaryRow(
                        id=row.id,
                        relation=row.relation,
                        words={
                            code: DictionaryWord(
                                word=word.word,
                                descr=word.descr,
                                also=list(word.also),
                                address=list(word.address),
                                krama=word.krama,
                                krama_inggil=word.krama_inggil,
                                note=word.note,
                            )
                            for code in LANGUAGES
                            if (word := row.words.get(code)) is not None
                        },
                    )
                    for row in section.rows
                ],
            )
            for section in sections
        ],
    )


async def kinship_settings(ctx: Context) -> KinshipSettings:
    return await asyncio.to_thread(read_kinship_settings, ctx.data_dir)


async def save_kinship_settings(ctx: Context, settings: KinshipSettings) -> KinshipSettings:
    await asyncio.to_thread(write_kinship_settings, ctx.data_dir, settings)
    return settings


async def books_for(ctx: Context) -> dict[str, TermBook]:
    """The word lists, Malay with the family's birth-order titles from Settings."""
    settings = await kinship_settings(ctx)
    return term_books(Titles(tuple(settings.titles), settings.youngest))


async def _kinds(ctx: Context) -> dict[str, RelationshipKind]:
    return {
        kind.key: kind
        for kind in await kinds_repo.list_relationship_kinds(ctx.driver, ctx.database)
    }


def family_from_rows(
    people: Sequence[Mapping[str, Any]],
    links: Sequence[Mapping[str, Any]],
    kinds: Mapping[str, RelationshipKind],
) -> Family:
    """The finder's view of the rows the tree is drawn from."""
    return Family(
        [
            Member(
                str(row["id"]),
                "an unknown parent" if row.get("placeholder") else _name(row),
                Gender(row.get("gender") or Gender.UNKNOWN),
                birth_from_row(row),
                row.get("birth_order"),
                bool(row.get("placeholder")),
            )
            for row in people
        ],
        [
            ParentLink(
                str(link["id"]),
                str(link["source"]),
                str(link["target"]),
                link.get("kind") or BIOLOGICAL,
            )
            for link in links
            if link["type"] == "parent"
        ],
        [
            Marriage(
                str(link["id"]),
                str(link["source"]),
                str(link["target"]),
                SpouseStatus(link.get("status") or SpouseStatus.MARRIED),
            )
            for link in links
            if link["type"] == "spouse"
        ],
        kinds,
    )


def term_books(titles: Titles | None = None) -> dict[str, TermBook]:
    """The word lists of every kinship language, Malay with the family's titles."""
    books: dict[str, TermBook] = {code: TermBook.load(code) for code in LANGUAGES}
    if titles is not None:
        books["ms"] = books["ms"].with_titles(titles)
    return books


class Finder:
    """The relationship finder for one family: made once, then asked about any two people."""

    def __init__(
        self,
        people: Sequence[Mapping[str, Any]],
        links: Sequence[Mapping[str, Any]],
        kinds: Mapping[str, RelationshipKind],
        books: Mapping[str, TermBook] | None = None,
    ) -> None:
        self.rows = {str(row["id"]): row for row in people}
        self.family = family_from_rows(people, links, kinds)
        self.books = books if books is not None else term_books()

    def answer(self, a: UUID, b: UUID) -> KinshipAnswer:
        first, second = self.rows.get(str(a)), self.rows.get(str(b))
        if first is None or second is None:
            raise NotFoundError("That person isn't in the tree.")

        message: str | None = None
        relations: list[Relation] = []
        if a == b:
            message = f"That's {_name(first)} again: pick someone else."
        elif first.get("placeholder") or second.get("placeholder"):
            message = "An unknown parent can't be compared. Fill them in first."
        else:
            relations = relate(self.family, str(a), str(b), TermBook.load("en"), self.books)
            if not relations:
                message = f"No recorded link between {_name(first)} and {_name(second)} yet."

        mentioned = [str(a), str(b)]
        for relation in relations:
            mentioned += [*relation.path, *relation.shared_ancestors]
        return KinshipAnswer(
            a=a,
            b=b,
            relations=[_relation(relation) for relation in relations],
            people=[_person(self.rows[person]) for person in dict.fromkeys(mentioned)],
            message=message,
        )


def answer(
    people: Sequence[Mapping[str, Any]],
    links: Sequence[Mapping[str, Any]],
    kinds: Mapping[str, RelationshipKind],
    a: UUID,
    b: UUID,
    books: Mapping[str, TermBook] | None = None,
) -> KinshipAnswer:
    return Finder(people, links, kinds, books).answer(a, b)


def twin_inputs(books: Mapping[str, TermBook]) -> dict[str, Any]:
    """What a view-only copy's kinship engine needs besides the family and its kinds:
    the word lists as the answers use them, the Malay titles included, and the dictionary rows
    that answers are matched to. The copy has the rules; the words are never written twice."""
    return {
        "books": {code: books[code].for_twin() for code in LANGUAGES},
        "rows": [[row_id, spec] for row_id, spec in dictionary.kin_specs()],
    }


def _name(row: Mapping[str, Any]) -> str:
    return short_name(str(row["full_name"]), row.get("nickname"))


def _person(row: Mapping[str, Any]) -> KinPerson:
    placeholder = bool(row.get("placeholder"))
    return KinPerson(
        id=UUID(str(row["id"])),
        name=UNKNOWN_PARENT if placeholder else _name(row),
        full_name=str(row["full_name"]),
        gender=Gender(row.get("gender") or Gender.UNKNOWN),
        photo_version=row.get("photo_version"),
        placeholder=placeholder,
    )


def _statement(statement: Statement) -> KinStatement:
    return KinStatement(
        term=statement.term,
        sentence=statement.sentence,
        detail=statement.detail,
        words={
            code: KinWord(term=said.term, sentence=said.sentence, english=said.english)
            for code in LANGUAGES
            if (said := statement.words.get(code)) is not None
        },
        entry=dictionary.row_for(statement.kin) if statement.kin else None,
    )


def _relation(relation: Relation) -> KinRelation:
    explained = relation.explanation
    return KinRelation(
        type=relation.type,
        forward=_statement(relation.forward),
        reverse=_statement(relation.reverse),
        generations=relation.generations,
        shared_ancestors=[UUID(p) for p in relation.shared_ancestors],
        path=[UUID(p) for p in relation.path],
        links=[UUID(link) for link in relation.links],
        explanation=KinExplanation(
            sentences=list(explained.sentences),
            top=explained.top,
            pair=explained.pair,
            removed=explained.removed,
            rule=explained.rule,
        )
        if explained
        else None,
    )
