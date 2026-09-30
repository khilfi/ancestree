"""The relationship finder: how any two people are related.

Pure Python with no database or web code, so it can be tested with hundreds of cases:

- `family`: the family as the finder sees it;
- `blood`: climbing to the nearest shared ancestors;
- `routes`: the shortest ways round through marriages and other kinds of link;
- `kin`: what a route means, as a structure any language can name;
- `terms`: the words, from `terms/en.yaml` and `terms/ms.yaml`;
- `finder`: putting it together, both ways round, with the path to highlight.
"""
