import pytest
from pydantic import ValidationError

from ancestree.domain.person import DateQualifier
from ancestree.domain.requests import PersonInput


def test_form_blanks_become_unknown_and_names_are_tidied() -> None:
    data = PersonInput.model_validate(
        {
            "full_name": "  Hassan   bin  Ismail ",
            "nickname": "   ",
            "birth_date": "",
            "residence": {"town": "", "state": " ", "country": "Malaysia"},
        }
    )

    assert data.full_name == "Hassan bin Ismail"
    assert data.nickname is None
    assert data.birth_date is None
    assert data.residence is None


def test_typed_dates_are_read_on_the_way_in() -> None:
    data = PersonInput.model_validate({"full_name": "X", "birth_date": "c. 1920"})

    assert data.birth_date is not None
    assert (data.birth_date.year, data.birth_date.qualifier) == (1920, DateQualifier.ABOUT)


def test_a_place_abroad_is_kept_even_without_a_town() -> None:
    data = PersonInput.model_validate({"full_name": "X", "birth_place": {"country": "Singapore"}})

    assert data.birth_place is not None
    assert data.birth_place.country == "Singapore"


def test_an_unreadable_date_fails_on_its_own_field() -> None:
    with pytest.raises(ValidationError) as caught:
        PersonInput.model_validate({"full_name": "X", "death_date": "yesterday"})

    [error] = caught.value.errors()
    assert error["loc"] == ("death_date",)
    assert "Couldn't read 'yesterday'" in error["msg"]


def test_a_name_is_required() -> None:
    with pytest.raises(ValidationError):
        PersonInput.model_validate({"full_name": "   "})
