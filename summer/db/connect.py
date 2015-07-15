import sqlite3


def connect_db():
	db = sqlite3.connect('./summer/blog.db')
	db.row_factory = sqlite3.Row
	return db


if __name__ == '__main__':
	connect_db()