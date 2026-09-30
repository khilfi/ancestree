"""What an answer means, with the actual people.

For blood relatives: who shares which ancestors, and what "removed" means, with where the two
lines meet for the ladder. For in-laws, step-family and longer chains: whose relative each one
is, by name. Always English, like the rest of the app, and by name rather than "their"
where a gender isn't recorded.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from ancestree.domain.person import Gender
from ancestree.kinship.blood import BloodTie
from ancestree.kinship.family import Family
from ancestree.kinship.kin import Blood, pieces
from ancestree.kinship.routes import Step
from ancestree.kinship.terms import TermBook

COUSIN_RULE = (
    "Cousins are counted by the ancestors they share: grandparents for first cousins, "
    'great-grandparents for second cousins. "Removed" counts the generations between them.'
)

_NUMBERS = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")
_ORDINALS = ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
             "ninth", "tenth")  # fmt: skip


@dataclass(frozen=True)
class Explanation:
    sentences: tuple[str, ...]
    # Blood relatives: where on the path the two lines meet (the shared ancestor's index), the
    # two at the same generation ("second cousins"), and what the rest is called.
    top: int | None = None
    pair: str | None = None
    removed: str | None = None
    rule: str | None = None


def _number(count: int) -> str:
    return _NUMBERS[count - 1] if 1 <= count <= len(_NUMBERS) else str(count)


def _ordinal(count: int) -> str:
    return _ORDINALS[count - 1] if 1 <= count <= len(_ORDINALS) else f"{count}th"


def generations_apart(count: int) -> str:
    """ "one generation", "three generations"."""
    return f"{_number(count)} generation{'' if count == 1 else 's'}"


def times_removed(count: int) -> str:
    """ "once removed", "twice removed", "three times removed"."""
    times = {1: "once", 2: "twice"}.get(count, f"{_number(count)} times")
    return f"{times} removed"


def _ancestor_word(generations: int, plural: bool) -> str:
    """ "parents", "grandparent", "great-great-grandparents"."""
    if generations > 6:
        return f"ancestor{'s' if plural else ''} {generations} generations up"
    word = "parent" if generations == 1 else "great-" * (generations - 2) + "grandparent"
    return f"{word}s" if plural else word


def _a(word: str) -> str:
    return f"{'an' if word[:1] in 'aeiou' else 'a'} {word}"


def _joined(names: Sequence[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


class _Say:
    """Names and words for one family."""

    def __init__(self, family: Family, english: TermBook) -> None:
        self.family = family
        self.english = english

    def name(self, person: str) -> str:
        return self.family.members[person].name

    def gender(self, person: str) -> Gender:
        return self.family.gender(person)

    def blood(self, up: int, down: int, person: str) -> str:
        """The English word for someone `up` and `down` from another: "son", "grandmother"."""
        fallback = "parent" if down == 0 else "child" if up == 0 else "relative"
        return self.english.blood(Blood(up, down, self.gender(person))) or fallback

    def shared(self, generations: int, ancestors: tuple[str, ...]) -> str:
        """ "great-grandparents, Tok Ismail & Nenek Fatimah"; "a grandparent, Tok Ismail"."""
        one = len(ancestors) == 1
        word = _ancestor_word(generations, plural=not one)
        known = [self.name(p) for p in ancestors if not self.family.members[p].placeholder]
        if not known:
            return f"{_a(word)} who isn't recorded yet" if one else f"{word} who aren't recorded"
        return f"{_a(word) if one else word}, {' & '.join(known)}"

    def siblings(self, a: str, b: str, half: bool) -> str:
        """ "brothers", "sisters", "half-siblings": the two of them together."""
        genders = {self.gender(a), self.gender(b)}
        word = "brothers" if genders == {Gender.MALE} else "sisters"
        if genders != {Gender.MALE} and genders != {Gender.FEMALE}:
            word = "siblings"
        return f"half-{word}" if half else word


def explain_blood(family: Family, english: TermBook, a: str, b: str, tie: BloodTie) -> Explanation:
    """How B is related to A by blood, told with the people on the path."""
    say = _Say(family, english)
    up, down, path = tie.up, tie.down, tie.path
    if not up or not down:
        return Explanation((_direct_line(say, a, b, tie),))

    nearest = min(up, down)  # the generations from the shared ancestors to the nearer one
    if nearest == 1:
        return _close(say, a, b, tie)

    # Cousins: the two at the same generation share ancestors `nearest` generations up; the
    # rest of the longer line is how many times "removed".
    removed = abs(up - down)
    left, right = (a, path[2 * up]) if down >= up else (path[up - down], b)
    cousins = f"{_ordinal(nearest - 1)} cousins"
    sentences = [
        f"{say.name(left)} and {say.name(right)} are {cousins}: they share "
        f"{say.shared(nearest, tie.ancestors)}."
    ]
    if removed:
        lower, above, other = (b, right, a) if down > up else (a, left, b)
        sentences.append(
            f"{say.name(lower)} is {say.name(above)}'s {say.blood(0, removed, lower)}, "
            f"{generations_apart(removed)} below {say.name(other)}: that's what "
            f'"{times_removed(removed)}" means.'
        )
    return Explanation(
        tuple(sentences),
        top=up,
        pair=cousins,
        removed=times_removed(removed) if removed else None,
        rule=COUSIN_RULE,
    )


def _close(say: _Say, a: str, b: str, tie: BloodTie) -> Explanation:
    """Brothers and sisters, and the lines just below them: uncles, aunts, nephews, nieces."""
    up, down, path = tie.up, tie.down, tie.path
    half = len(tie.ancestors) == 1
    if up == down == 1:
        parents = [say.name(p) for p in tie.ancestors if not say.family.members[p].placeholder]
        if half:
            shared = f"one parent, {parents[0]}" if parents else "one parent who isn't recorded"
        else:
            shared = f"their parents, {' & '.join(parents)}" if parents else "their parents"
        sentence = f"{say.name(a)} and {say.name(b)} share {shared}."
        return Explanation((sentence,), top=up, pair=say.siblings(a, b, half))
    if up == 1:  # B descends from A's brother or sister
        sibling = path[2]
        sentence = (
            f"{say.name(b)} is {say.name(sibling)}'s {say.blood(0, down - 1, b)}, and "
            f"{say.name(sibling)} is {say.name(a)}'s {say.blood(1, 1, sibling)}: "
            f"{generations_apart(down - 1)} below {say.name(a)}."
        )
        return Explanation((sentence,), top=up, pair=say.siblings(a, sibling, half))
    ancestor = path[up - 1]  # B is the brother or sister of A's parent (or grandparent)
    sentence = (
        f"{say.name(b)} is the {say.blood(1, 1, b)} of {say.name(a)}'s "
        f"{say.blood(up - 1, 0, ancestor)}, {say.name(ancestor)}: "
        f"{generations_apart(up - 1)} above {say.name(a)}."
    )
    return Explanation((sentence,), top=up, pair=say.siblings(ancestor, b, half))


def _direct_line(say: _Say, a: str, b: str, tie: BloodTie) -> str:
    """ "Mariam is Siti's mother's mother, through Aminah: two generations above Siti"."""
    upward = tie.up > 0
    steps = tie.up or tie.down
    words = [say.blood(1, 0, p) if upward else say.blood(0, 1, p) for p in tie.path[1:]]
    through = [say.name(p) for p in tie.path[1:-1]]
    via = f", through {_joined(through)}" if through else ""
    return (
        f"{say.name(b)} is {say.name(a)}'s {"'s ".join(words)}{via}: "
        f"{generations_apart(steps)} {'above' if upward else 'below'} {say.name(a)}."
    )


def explain_route(family: Family, english: TermBook, a: str, route: list[Step]) -> Explanation:
    """In-laws, step-family, adoption and longer chains: whose relative each one is, by name.
    "Kamal is the brother of Siti's husband, Ahmad"."""
    say = _Say(family, english)
    found = pieces(family, a, route)
    words = [english.term(piece.kin, family.kinds) or "relative" for piece in found]
    if len(found) == 1:
        return Explanation((f"{say.name(found[0].end)} is {say.name(a)}'s {words[0]}.",))
    if len(found) == 2:
        first, second = found
        return Explanation(
            (
                f"{say.name(second.end)} is the {words[1]} of {say.name(a)}'s {words[0]}, "
                f"{say.name(first.end)}.",
            )
        )
    walk = [
        f"{say.name(piece.start)}'s {word} is {say.name(piece.end)}"
        for piece, word in zip(found, words, strict=True)
    ]
    return Explanation((f"{'; '.join(walk[:-1])}; and {walk[-1]}.",))
