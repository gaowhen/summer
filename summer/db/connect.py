# -*- coding: utf-8 -*-

import sqlite3


def connect_db():
    db = sqlite3.connect('./summer/blog.db')
    db.row_factory = sqlite3.Row
    return db


def get_db():
    """Opens a new database connection if there is none yet for the
    current application context.
    """
    if not hasattr(get_db, 'sqlite_db'):
        get_db.sqlite_db = connect_db()
    return get_db.sqlite_db
