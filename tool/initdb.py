from contextlib import closing

from summer.app import create_app
from summer.db.connect import connect_db


def init_db():
    app = create_app('product')
    _context = app.app_context()
    _context.push()
    with closing(connect_db()) as db:
        with open('./summer/schema.sql', mode='r') as f:
            db.cursor().executescript(f.read())
            db.commit()

if __name__ == '__main__':
    init_db()
