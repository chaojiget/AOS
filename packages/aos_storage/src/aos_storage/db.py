from sqlmodel import SQLModel, create_engine, Session

# Using SQLite by default for simplicity in v0.2
sqlite_file_name = "aos_memory.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

engine = create_engine(sqlite_url, echo=False)


def init_db():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
