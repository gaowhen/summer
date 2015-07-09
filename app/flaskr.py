# -*- coding: utf-8 -*-

import codecs
import glob
import yaml
import os
import ntpath
import sqlite3

from flask import Flask, request, g, redirect, render_template, jsonify
from contextlib import closing
from flask.ext.mako import MakoTemplates, render_template
from flask.ext.misaka import markdown
from slugify import slugify
from werkzeug import secure_filename
from mako.template import Template
from mako.lookup import TemplateLookup

app = Flask(__name__)
app.config.from_pyfile('app.cfg')

mako = MakoTemplates(app)


def connect_db():
	db = sqlite3.connect(app.config['DATABASE'])
	db.row_factory = sqlite3.Row
	return db


def init_db():
	with closing(connect_db()) as db:
		with app.open_resource('schema.sql', mode='r') as f:
			db.cursor().executescript(f.read())
			db.commit()


def fill_db():
	files = glob.glob('./post/*.md')

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


@app.before_request
def before_request():
	g.db = connect_db()


@app.teardown_request
def teardown_request(exception):
	db = getattr(g, 'db', None)
	if db is not None:
		db.close()


@app.route('/upload', methods=['POST', ])
def upload():
	if request.method == 'POST':
		_file = request.files['file']

		if _file:
			filename = secure_filename(_file.filename)
			_file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
			return jsonify(r=True, path='/static/src/img/' + filename)

		return jsonify(r=False)

	return redirect('/')


@app.route('/')
def show_entries():
	cur = g.db.execute('select title, id, content from entries order by create_time desc limit 5')
	entries = []

	for row in cur.fetchall():
		_content = row['content'].split('<!--more-->')[0]
		content = markdown(_content)
		entry = dict(title=row['title'], id=row['id'], content=content)
		entries.append(entry)

	return render_template('index.html', **locals())


@app.route('/page/<int:page>')
def pagination(page):
	start = (page - 1) * 5

	cur = g.db.execute('select title, slug, content from entries order by create_time desc limit 5 offset ?', (start,))
	entries = [dict(title=row['title'], slug=row['slug'], content=markdown(row['content'])) for row in cur.fetchall()]

	return render_template('index.html', **locals())


@app.route('/new', methods=['GET', 'POST'])
def new_draft():
	if request.method == 'POST':
		title = request.form['title']
		slug = slugify(title)
		content = request.form['content']
		date = request.form['date']

		g.db.execute('insert into entries (title, content, create_time, slug, status) values (?, ?, ?, ?, "draft")',
								 [title, content, date, slug], )
		g.db.commit()

		filepath = os.path.join(app.config['DRAFT_FOLDER'], slug + '.md')
		newfile = open(unicode(filepath, 'utf8'), 'w')

		newfile.write('title: \"' + title + '\"\n')
		newfile.write('date: ' + date + '\n')
		newfile.write('---' + '\n\n')
		newfile.write(content.encode('utf8'))
		newfile.write('\n')
		newfile.close()

		return jsonify(r=True)

	return render_template('new.html', **locals())


@app.route('/publish', methods=['POST'])
def publish_draft():
    if request.method == 'POST':
        title = request.form['title']
        slug = slugify(title)

        cur = g.db.execute('update entries set status=? where slug=?', ("publish", slug))
        g.db.commit()

        draft_file = os.path.join(app.config['DRAFT_FOLDER'], slug + '.md')
        publish_file = os.path.join(app.config['POST_FOLDER'], slug + '.md')

        os.rename(draft_file, publish_file)

        return jsonify(r=True)


@app.route('/posts/<int:id>')
def show_entry(id):
	cur = g.db.execute('select title, content from entries where id=?', (id,))
	_entry = cur.fetchone()
	post_title = _entry['title']
	post_content = markdown(_entry['content'])

	return render_template('entry.html', **locals())


@app.route('/posts/<int:id>/edit')
def edit_entry(id):
	cur = g.db.execute('select title, content, slug from entries where id=?', (id,))
	_entry = cur.fetchone()
	post_title = _entry['title']
	post_content = _entry['content']
	slug = _entry['slug']

	return render_template('edit.html', **locals())


@app.route('/post/<int:id>/update', methods=['POST'])
def update_entry(id):
	if request.method == 'POST':
		cur = g.db.execute('select slug, create_time from entries where id=?', (id,))
		_entry = cur.fetchone()
		name = _entry['slug']
		create_time = _entry['create_time']

		title = request.form['title']
		slug = slugify(title)
		content = request.form['content']
		cur = g.db.execute('update entries set title=?, slug=?, content=? where id=?', (title, slug, content, id))
		g.db.commit()

		# delete old file
		os.remove(os.path.join(app.config['POST_FOLDER'], name + '.md'))

		# create new file
		filepath = os.path.join(app.config['POST_FOLDER'], slug + '.md')
		newfile = open(unicode(filepath, 'utf8'), 'w')

		newfile.write('title: \"' + title.encode('utf8') + '\"\n')
		newfile.write('date: ' + create_time + '\n')
		newfile.write('---' + '\n\n')
		newfile.write(content.encode('utf8'))
		newfile.write('\n')
		newfile.close()

		return jsonify(r=True)

	return redirect('/')


@app.route('/posts/<int:id>/del', methods=['POST'])
def delete_entry(id):
	if request.method == 'POST':
		cur = g.db.execute('select slug from entries where id=?', (id,))
		_entry = cur.fetchone()
		name = _entry['slug']

		cur = g.db.execute('delete from entries where id=?', (id,))
		g.db.commit()

		os.remove(os.path.join(app.config['POST_FOLDER'], name + '.md'))

		return jsonify(r=True)

	return redirect('/')


# generate index
def build_index():
	with closing(connect_db()) as db:
		cur = db.execute('select title, slug, content from entries order by create_time desc limit 5')
		entries = [dict(title=row['title'], slug=row['slug'], content=markdown(row['content'])) for row in cur.fetchall()]
		lookup = TemplateLookup(directories=['./templates'])
		template = Template(filename='./templates/index.html', lookup=lookup)
		html_content = template.render(entries=entries)

		dist = os.path.join(app.config['GHPAGES'], 'index.html')

		with codecs.open(dist, 'w', 'utf-8-sig') as f:
			f.write(html_content)


def build_pages():
	with closing(connect_db()) as db:
		cur = g.db.execute('select * from entries')
		length = len(cur.fetchall())

		for page in range(1, length / 5):
			start = (page - 1) * 5

			cur = g.db.execute('select title, slug, content from entries order by create_time desc limit 5 offset ?',
												 (start,))
			entries = [dict(title=row['title'], slug=row['slug'], content=markdown(row['content'])) for row in cur.fetchall()]

			lookup = TemplateLookup(directories=['./templates'])
			template = Template(filename='./templates/index.html', lookup=lookup)
			html_content = template.render(entries=entries)

			page_path = os.path.join(app.config['PAGES'], str(page))

			try:
				os.makedirs(page_path)
			except OSError:
				pass

			dist = os.path.join(page_path, 'index.html')

			with codecs.open(dist, 'w', 'utf-8-sig') as f:
				f.write(html_content)


def build_posts():
	with closing(connect_db()) as db:
		cur = g.db.execute('select title, content, slug from entries')

		for _entry in cur.fetchall():
			post_title = _entry['title']
			post_content = markdown(_entry['content'])
			post_slug = _entry['slug']

			lookup = TemplateLookup(directories=['./templates'])
			template = Template(filename='./templates/entry.html', lookup=lookup)
			html_content = template.render(post_title=post_title, post_content=post_content)

			dist = os.path.join(app.config['POSTS'], post_slug + '.html')

			with codecs.open(dist, 'w', 'utf-8-sig') as f:
				f.write(html_content)


# TODO
def build_archive():
	pass


@app.route('/build', methods=['POST', 'GET'])
def build():
	if request.method == 'POST':
		try:
			os.mkdir(app.config['PAGES'])
			os.mkdir(app.config['POSTS'])
		except OSError:
			pass

		# index
		build_index()
		# page
		build_pages()
		# post
		build_posts()
		# archive

		return jsonify(r=True)

	return jsonify(r=False)


if __name__ == '__main__':
	app.run()
