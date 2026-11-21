"""The tests' own timing of work on a busy PC (tests/timing.py), on a clock made up here."""

from collections.abc import Awaitable, Callable

import pytest

from tests.timing import at_best, fastest

pytestmark = pytest.mark.anyio


def counting() -> tuple[list[int], Callable[[], Awaitable[int]]]:
    """Work that says which try it is, and the tries so far."""
    calls: list[int] = []

    async def work() -> int:
        calls.append(len(calls) + 1)
        return calls[-1]

    return calls, work


async def test_a_try_within_the_limit_is_enough() -> None:
    calls, work = counting()

    result, timings = await fastest(work, 1.0, pause=0, clock=iter([0.0, 0.4]).__next__)

    assert (result, timings, calls) == (1, [0.4], [1])


async def test_a_slow_try_is_tried_again_until_one_is_within_the_limit() -> None:
    calls, work = counting()
    clock = iter([0.0, 2.0, 10.0, 11.5, 20.0, 20.5, 30.0, 30.1]).__next__

    result, timings = await fastest(work, 1.0, pause=0, clock=clock)

    assert (result, timings, calls) == (3, [2.0, 1.5, 0.5], [1, 2, 3])  # no fourth


async def test_it_gives_up_after_the_most_tries() -> None:
    calls, work = counting()
    clock = iter([0.0, 2.0, 10.0, 13.0, 20.0, 22.5, 30.0, 31.0]).__next__

    _, timings = await fastest(work, 1.0, tries=3, pause=0, clock=clock)

    assert (timings, calls) == ([2.0, 3.0, 2.5], [1, 2, 3])


def test_a_failure_says_the_fastest_and_every_try() -> None:
    assert at_best([1.3, 1.21, 1.25]) == "1210 ms at best (1300, 1210, 1250 ms)"
