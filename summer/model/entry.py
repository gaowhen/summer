from flask.ext.misaka import markdown

from summer.db.connect import get_db


class Entry(object):

    def __init__(self, id):
        self.id = id

    @classmethod
    def get(cls, id):
        db = get_db()
        cur = db.execute('select title, content, create_time, status, '
                         'slug from entries where id=?', (id,))
        _entry = cur.fetchone()

        entry = dict(
            title=_entry['title'],
            content=markdown(_entry['content']),
            date=_entry['create_time'],
            id=id,
            status=_entry['status'],
            slug=_entry['slug']
        )

        return entry

    @classmethod
    def get_page(cls, page=1):
        entries = []
        perpage = 5
        start = (page - 1) * 5

        db = get_db()
        cur = db.execute('select title, id, content, create_time, '
                         'status, slug from entries '
                         'order by create_time desc limit ? offset ?',
                         (perpage, start,))

        for _entry in cur.fetchall():
            _content = _entry['content'].split('<!--more-->')[0]
            content = markdown(_content)
            date = _entry['create_time']
            status = _entry['status']
            slug = _entry['slug']

            entry = dict(
                title=_entry['title'],
                id=_entry['id'],
                content=content,
                date=date,
                status=status,
                slug=slug
            )

            entries.append(entry)

        return entries

    @classmethod
    def get_length(cls):
        db = get_db()
        cur = db.execute('select * from entries')
        total = len(cur.fetchall())

        return total

    @classmethod
    def get_by_slug(cls, slug):
        db = get_db()
        # params must has comma to be a tupple
        cur = db.execute('select id from entries where slug = ?', (slug,))
        entry = cur.fetchone()

        return entry

    @classmethod
    def save_draft(cls, title, content, date, slug):
        db = get_db()
        db.execute('insert into entries '
                   '(title, content, create_time, slug, status) '
                   'values (?, ?, ?, ?, "draft")',
                   (title, content, date, slug))
        db.commit()

        entry = cls.get_by_slug(slug)

        return entry

    @classmethod
    def save_entry(cls, title, content, id):
        db = get_db()
        db.execute('update entries set title=?, content=? where id=?',
                   (title, content, id))
        db.commit()

        _entry = cls.get(id)

        return _entry

    @classmethod
    def delete(cls, id):
        entry = cls.get(id)
        db = get_db()
        db.execute('delete from entries where id=?', (id,))
        db.commit()
        return entry

    @classmethod
    def update(cls, title, content, id):
        db = get_db()
        db.execute('update entries set title=?, content=? where id=?',
                   (title, content, id))
        db.commit()

        entry = cls.get(id)

        return entry

    @classmethod
    def update_status(cls, id, status):
        db = get_db()
        db.execute('update entries set status=? where id=?', (status, id))
        db.commit()

        entry = cls.get(id)

        return entry

    @classmethod
    def get_published_page(cls, page=1):
        perpage = 5
        start = (page - 1) * 5
        entries = []

        db = get_db()
        cur = db.execute('select title, content, status, create_time, id, '
                         'slug from entries where status is not ? '
                         'order by create_time desc limit ? offset ?',
                         ('draft', perpage, start,))

        for row in cur.fetchall():
            status = row['status']
            title = row['title']
            date = row['create_time']
            id = row['slug']
            status = row['status']
            _content = row['content'].split('<!--more-->')[0]
            content = markdown(_content)

            entry = dict(
                title=title,
                content=content,
                date=date,
                id=id,
                status=status
            )
            entries.append(entry)

        return entries

    @classmethod
    def get_all_published(cls, is_need_summary=False):
        entries = []

        db = get_db()
        cur = db.execute('select title, content, slug, status, create_time'
                         ' from entries where status is not ? '
                         'order by create_time desc', ('draft',))

        for row in cur.fetchall():
            status = row['status']
            title = row['title']
            date = row['create_time']
            id = row['slug']
            status = row['status']

            if is_need_summary:
                _content = row['content'].split('<!--more-->')[0]
            else:
                _content = row['content']

            content = markdown(_content)
            slug = row['slug']

            entry = dict(
                title=title,
                content=content,
                date=date,
                id=id,
                status=status,
                slug=slug
            )
            entries.append(entry)

        return entries
