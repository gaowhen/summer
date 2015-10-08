# -*- coding: utf-8 -*-

import sqlite3
from flask import g, current_app


def connect_db():
    db = sqlite3.connect(current_app.config['DATABASE_URI'])
    db.row_factory = sqlite3.Row
    return db


# http://flask.pocoo.org/docs/0.10/appcontext/
def get_db():
    """Opens a new database connection if there is none yet for the
    current application context.
    """
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = connect_db()
    return db
