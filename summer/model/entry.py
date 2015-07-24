from contextlib import closing
from flask.ext.misaka import markdown
from summer.db.connect import connect_db

class Entry(object):

	def __init__(self, id):
		self.id = id

	@classmethod
	def get(cls, id):
		with closing(connect_db()) as db:
			cur = db.execute('select title, content, create_time, status, slug from entries where id=?', (id,))
			_entry = cur.fetchone()

			entry = dict(title=_entry['title'], content=_entry['content'], date=_entry['create_time'], id=id, status=_entry['status'], slug=_entry['slug'])

			return entry


	@classmethod
	def get_page(cls, page=1):
		entries = []
		perpage = 5
		start = (page - 1) * 5

		with closing(connect_db()) as db:
			cur = db.execute('select title, id, content, create_time, status, slug from entries order by create_time desc limit ? offset ?', (perpage, start,))

			for _entry in cur.fetchall():
				_content = _entry['content'].split('<!--more-->')[0]
				content = markdown(_content)
				date = _entry['create_time']
				status = _entry['status']
				slug = _entry['slug']

				entry = dict(title=_entry['title'], id=_entry['id'], content=content, date=date, status=status, slug=slug)

				entries.append(entry)

			return entries


	@classmethod
	def get_length(cls):
		with closing(connect_db()) as db:
			cur = db.execute('select * from entries')
			total = len(cur.fetchall())

			return total


	@classmethod
	def save_draft(cls, title, content, create_time, slug):
		with closing(connect_db()) as db:
			db.execute('insert into entries (title, content, create_time, slug, status) values (?, ?, ?, ?, "draft")',
									 [title, content, date, slug], )
			db.commit()

			cur = db.execute('select id from entries where slug = ?', (slug))
			_entry = cur.fetchone()

			return _entry


	@classmethod
	def save_entry(cls, title, content, id):
		with closing(connect_db()) as db:
			cur = db.execute('update entries set title=?, content=? where id=?', (title, content, id))
			db.commit()

			cur = db.execute('select slug, create_time, status from entries where id=?', (id,))

			_entry = cur.fetchone()

			return _entry


	@classmethod
	def delete(clc, id):
		with closing(connect_db()) as db:
			cur = db.execute('delete from entries where id=?', (id,))
			db.commit()

			entry = self.get(id)

			return entry


	@classmethod
	def update(cls, title, content, id):
		with closing(connect_db()) as db:
			cur = db.execute('update entries set title=?, content=? where id=?', (title, content, id))
			db.commit()

			entry = self.get(id)

			return entry


	@classmethod
	def update_status(cls, id, status):
		with closing(connect_db()) as db:
			cur = db.execute('update entries set status=? where id=?', (status, id))
			db.commit()

			entry = self.get(id)

			return entry







