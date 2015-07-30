import os
from contextlib import closing
from summer.db.connect import connect_db


def init_db():
    with closing(connect_db()) as db:
        with open('./summer/schema.sql', mode='r') as f:
            db.cursor().executescript(f.read())
            db.commit()

if __name__ == '__main__':
    init_db()
