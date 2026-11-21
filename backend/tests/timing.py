"""Timing work in the tests on a PC that may be busy with other things, such as several runs of
the checks at once."""

import asyncio
import time
from collections.abc import Awaitable, Callable


async def fastest[T](
    work: Callable[[], Awaitable[T]],
    limit: float,
    *,
    tries: int = 5,
    pause: float = 0.25,
    clock: Callable[[], float] = time.perf_counter,
) -> tuple[T, list[float]]:
    """What `work` gave the last time, and how long each try took, in seconds: tried again,
    after a pause, until a try is within `limit`, and `tries` times at most. Hold the fastest
    to the limit. Whatever else the PC is doing only ever makes a try slower, never quicker, so
    the fastest is the nearest to the work's own time, and a real slowdown makes every try
    slow, so it still fails. On a quiet PC, the first try is enough."""
    timings: list[float] = []
    while True:
        started = clock()
        result = await work()
        timings.append(clock() - started)
        if timings[-1] < limit or len(timings) >= tries:
            return result, timings
        await asyncio.sleep(pause)  # whatever else is running may pause too


def at_best(timings: list[float]) -> str:
    """The tries' times for a failure's message: "1210 ms at best (1300, 1210 ms)"."""
    each = ", ".join(f"{timing * 1000:.0f}" for timing in timings)
    return f"{min(timings) * 1000:.0f} ms at best ({each} ms)"
