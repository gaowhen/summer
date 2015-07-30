import os
import glob
import ntpath
from contextlib import closing
import yaml

from summer.db.connect import connect_db


def fill_draft():
    files = glob.glob('./summer/_draft/*.md')

    for name in files:
        try:
            with open(name) as f:
                print name
                _file = f.read().decode('utf-8')
                meta = _file.split('---')[0]
                content = _file.split('---')[1]

                title = yaml.load(meta)['title']
                slug = os.path.splitext(ntpath.basename(f.name))[0]
                create_time = yaml.load(meta)['date']
                category = ','.join(yaml.load(meta)['categories']) if yaml.load(meta)['categories'] else ''
                tag = ','.join(yaml.load(meta)['tags']) if yaml.load(meta)['tags'] else ''

                with closing(connect_db()) as db:
                    db.execute('insert into entries (title, slug, content, create_time, category, tag, status) values (?, ?, ?, ?, ?, ?, "draft")',
                                         [title, slug, content, create_time, category, tag])
                    db.commit()

        except IOError as exc:
            if exc.errno != errno.EISDIR:
                raise


def fill_post():
    files = glob.glob('./summer/post/*.md')

    for name in files:
        try:
            with open(name) as f:
                print name
                _file = f.read().decode('utf-8')
                meta = _file.split('---')[0]
                content = _file.split('---')[1]

                title = yaml.load(meta)['title']
                slug = os.path.splitext(ntpath.basename(f.name))[0]
                create_time = yaml.load(meta)['date']
                category = ','.join(yaml.load(meta)['categories']) if yaml.load(meta)['categories'] else ''
                tag = ','.join(yaml.load(meta)['tags']) if yaml.load(meta)['tags'] else ''

                with closing(connect_db()) as db:
                    db.execute('insert into entries (title, slug, content, create_time, category, tag) values (?, ?, ?, ?, ?, ?)',
                                         [title, slug, content, create_time, category, tag])
                    db.commit()

        except IOError as exc:
            if exc.errno != errno.EISDIR:
                raise


def fill_db():
   fill_post()
   fill_draft()

if __name__ == '__main__':
    fill_db()
