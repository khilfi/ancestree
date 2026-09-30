from ancestree.migrations.runner import load_migrations, split_statements


def test_statements_are_split_on_semicolons_and_comments_are_dropped() -> None:
    text = """
    // a comment; with a semicolon
    CREATE INDEX a IF NOT EXISTS FOR (p:Person) ON (p.x);

    CREATE INDEX b IF NOT EXISTS
    FOR (p:Person) ON (p.y);
    """

    statements = split_statements(text)

    assert statements == (
        "CREATE INDEX a IF NOT EXISTS FOR (p:Person) ON (p.x)",
        "CREATE INDEX b IF NOT EXISTS\n    FOR (p:Person) ON (p.y)",
    )


def test_migrations_load_in_version_order_and_none_is_empty() -> None:
    migrations = load_migrations()

    assert [(m.version, m.name) for m in migrations] == [
        (1, "schema"),
        (2, "default_relationship_kinds"),
        (3, "kind_words"),
    ]
    assert all(m.statements for m in migrations)
