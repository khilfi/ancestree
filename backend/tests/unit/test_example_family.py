"""The example family, as it's defined: about 65 made-up
people grown from the test family's, every shape of family the app knows, Malay and Javanese
names and titles, places from Kelantan to Singapore and Melbourne, pinned at both levels, dates
from the 1870s to now, life stories using every part and what people say, and portraits drawn,
the same each time."""

import io
from collections import Counter
from datetime import date

from PIL import Image

from ancestree.domain.biography import PARTS
from ancestree.domain.person import DateQualifier
from ancestree.domain.relationship import SpouseStatus
from ancestree.seed.drawing import PORTRAIT, portrait
from ancestree.seed.example import example_stories, load_example_family
from ancestree.seed.family import load_seed_family
from ancestree.services.biography import biography_from

FAMILY = load_example_family()
BY_KEY = {person.key: person for person in FAMILY.people}


def parents_of(key: str) -> set[str]:
    return {parent for unit in FAMILY.families if key in unit.children for parent in unit.parents}


def test_about_sixty_people_grown_from_the_test_familys_own() -> None:
    assert len(FAMILY.people) == 65
    seed = {person.key for person in load_seed_family().people}
    assert seed <= set(BY_KEY)  # every one of the test family's, and more
    assert FAMILY.name == "Keluarga Contoh"


def test_every_shape_of_family() -> None:
    marriages = Counter(key for marriage in FAMILY.marriages for key in marriage.spouses)
    statuses = {marriage.status for marriage in FAMILY.marriages}
    assert marriages["rahman"] == 2
    assert marriages["karim"] == 2
    assert {SpouseStatus.DIVORCED, SpouseStatus.WIDOWED} <= statuses
    assert any(unit.kind == "adoptive" for unit in FAMILY.families)  # an adoption
    twins = (BY_KEY["aida"], BY_KEY["aina"])
    assert twins[0].born == twins[1].born
    assert {t.birth_order for t in twins} == {1, 2}
    # Cousins who married: Azman and Nor share their grandparents.
    grand = [
        set().union(*(parents_of(parent) for parent in parents_of(key))) for key in ("azman", "nor")
    ]
    assert grand[0] & grand[1] == {"ismail", "fatimah"}
    assert sorted(
        child
        for unit in FAMILY.families
        if unit.parents == ["unknown_parent_of_mariam"]
        for child in unit.children
    ) == ["mariam", "salmah"]
    # Six generations, from Ahmad bin Musa to his great-great-great-grandson Yusuf.
    line, key = ["yusuf"], "yusuf"
    while parents := sorted(parents_of(key) & {"danial", "karim", "hassan", "ismail", "ahmad"}):
        key = parents[0]
        line.append(key)
    assert line == ["yusuf", "danial", "karim", "hassan", "ismail", "ahmad"]


def test_malay_and_javanese_names_titles_and_jawi() -> None:
    titles = {person.title for person in FAMILY.people if person.title}
    assert {"Haji", "Hajah", "Dato'", "Datin"} <= titles
    assert sum(1 for person in FAMILY.people if person.name_jawi) >= 5
    assert BY_KEY["painem"].nickname == "Mbah Nem"  # the Javanese side
    assert BY_KEY[FAMILY.me].full_name == "Danial bin Karim"  # a grandchild, as Me
    assert FAMILY.titles[:2] == ["long", "ngah"]
    assert FAMILY.youngest == "su"


def test_places_from_kelantan_to_singapore_and_melbourne_at_both_levels() -> None:
    homes = [person.residence for person in FAMILY.people if person.residence]
    countries = {home.country for home in homes}
    assert {"Malaysia", "Singapore", "Australia"} <= countries
    exact = [home for home in homes if home.exact in ("spot", "hand")]
    about = [home for home in homes if home.exact == "postcode"]
    towns = [home for home in homes if home.lat is None]
    assert len(exact) >= 5
    assert len(about) >= 2
    assert len(towns) >= 10
    assert all(home.address and home.postcode for home in exact)
    states = {home.state for home in homes if home.country == "Malaysia"}
    assert len(states) >= 8


def test_dates_from_the_1870s_to_now() -> None:
    born = [person.born for person in FAMILY.people if person.born and person.born.year]
    years = sorted(when.year for when in born if when.year)
    assert years[0] < 1880
    assert years[-1] >= 2020
    assert {when.qualifier for when in born} >= {DateQualifier.ABOUT, DateQualifier.BETWEEN}
    assert sum(1 for person in FAMILY.people if person.died) >= 12


def test_life_stories_use_every_part_and_what_people_say() -> None:
    told = example_stories()
    assert set(told) <= set(BY_KEY)
    lives = {key: biography_from(text) for key, text in told.items()}
    used = {part for life in lives.values() for part in life.parts}
    assert used == set(PARTS)
    said = [words for life in lives.values() for words in life.said]
    assert len(said) >= 6
    assert {words.writer for words in said} >= {"Zulkifli bin Hassan", "Danial bin Karim"}
    assert any(words.device is None for words in said)  # Danial's, as this computer's own
    pictures = sum(text.count("](scene:") for text in told.values())
    assert pictures >= 4


def test_portraits_are_drawn_the_same_each_time_and_each_their_own() -> None:
    today = date(2026, 10, 14)
    looks = [person.look(today) for person in FAMILY.people]
    drawn = [look for look in looks if look is not None]
    assert len(drawn) == 64  # all but the unknown parent
    hassan = BY_KEY["hassan"].look(today)
    assert hassan is not None
    assert portrait(hassan) == portrait(hassan)
    image = Image.open(io.BytesIO(portrait(hassan)))
    assert image.size == (PORTRAIT, PORTRAIT)
    assert len({portrait(look) for look in drawn[:12]}) == 12


def test_everyone_is_linked_into_the_tree() -> None:
    linked = {key for unit in FAMILY.families for key in [*unit.parents, *unit.children]}
    linked |= {key for marriage in FAMILY.marriages for key in marriage.spouses}
    assert linked == set(BY_KEY)
