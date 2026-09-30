"""Things worth a second look, reported as notices; the change is still saved."""

import re
from dataclasses import dataclass

from ancestree.domain.person import Gender, PartialDate
from ancestree.domain.views import Notice

_PATRONYMIC = re.compile(r"\s(?:bin|binti|bte?\.?|b\.)\s+(?P<father>.+)$", re.IGNORECASE)
# Earned or courtesy titles that come and go in a name over a lifetime.
_TITLES = {"haji", "hj", "hajah", "hjh", "dato", "datuk", "datin", "tan", "sri", "tun", "dr"}


@dataclass(frozen=True)
class Facts:
    name: str
    gender: Gender
    birth: PartialDate | None
    death: PartialDate | None


def _year(date: PartialDate | None) -> int | None:
    return date.year if date is not None else None


def life_notices(person: Facts) -> list[Notice]:
    born, died = _year(person.birth), _year(person.death)
    if born is not None and died is not None and died < born:
        return [Notice(code="died_before_born", message=f"{person.name} died before being born.")]
    return []


def parent_child_notices(parent: Facts, child: Facts, *, blood: bool) -> list[Notice]:
    notices = []
    parent_born, child_born = _year(parent.birth), _year(child.birth)
    if parent_born is not None and child_born is not None:
        gap = child_born - parent_born
        if gap <= 0:
            notices.append(
                Notice(
                    code="parent_younger",
                    message=f"{parent.name} is recorded as born after {child.name}.",
                )
            )
        elif gap < 12:
            notices.append(
                Notice(
                    code="parent_too_young",
                    message=(
                        f"{parent.name} would have been about {gap} when {child.name} was born."
                    ),
                )
            )
    parent_died = _year(parent.death)
    # A father may die before his child is born; a mother cannot.
    grace = 1 if parent.gender is Gender.MALE else 0
    if parent_died is not None and child_born is not None and child_born > parent_died + grace:
        notices.append(
            Notice(
                code="born_after_parent_died",
                message=f"{child.name} is recorded as born after {parent.name} died.",
            )
        )
    if blood and parent.gender is Gender.MALE:
        notices.extend(_patronymic_notices(parent.name, child.name))
    return notices


def _patronymic_notices(father: str, child: str) -> list[Notice]:
    """Malay names carry the father's name: "Aminah binti Hassan" is Hassan's daughter."""
    match = _PATRONYMIC.search(child)
    if not match:
        return []
    fathers_part = _PATRONYMIC.split(father, maxsplit=1)[0]
    if _name_words(match["father"]) == _name_words(fathers_part):
        return []
    return [
        Notice(
            code="patronymic_mismatch",
            message=(
                f"{child}'s name says the father is {match['father'].strip()}, "
                f"but {father} is being linked as the father."
            ),
        )
    ]


def _name_words(name: str) -> list[str]:
    words = re.findall(r"[\w']+", name.casefold())
    return [word.rstrip("'") for word in words if word.rstrip("'.") not in _TITLES]
