"""The app's own Neo4j: fetched once, then started and stopped with the app.

The desktop app runs where there's no Docker, so it brings its own Neo4j, and a Java to run
it, fetched the first time from their publishers and checked against the fingerprints in
`runtime`. The database listens only on this computer, with a password of its own, and
reports and announces nothing. Your Neo4j in Docker still works: the app connects to
whichever its settings name.
"""
