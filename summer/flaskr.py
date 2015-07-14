# -*- coding: utf-8 -*-

import codecs
import yaml
import os
from datetime import datetime
import shutil
import math

from flask import Flask, request, g, redirect, render_template, jsonify
from contextlib import closing
from flask.ext.mako import MakoTemplates, render_template
from flask.ext.misaka import markdown
from slugify import slugify
from werkzeug import secure_filename
from mako.template import Template
from mako.lookup import TemplateLookup

from db.connect import connect_db


app = Flask(__name__)
app.config.from_pyfile('app.cfg')

mako = MakoTemplates(app)


@app.before_request
def before_request():
	g.db = connect_db()
	g.debug = True


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
			return jsonify(r=True, path='/static/img/' + filename)

		return jsonify(r=False)

	return redirect('/')


@app.route('/')
def show_entries():
	cur = g.db.execute('select title, id, content, create_time from entries order by create_time desc limit 5')
	perpage = 5
	entries = []

	for row in cur.fetchall():
		_content = row['content'].split('<!--more-->')[0]
		content = markdown(_content)
		date = row['create_time']
		entry = dict(title=row['title'], id=row['id'], content=content, date=date)
		entries.append(entry)

	cur = g.db.execute('select * from entries')
	total = len(cur.fetchall())
	page = 1

	return render_template('index.html', **locals())


@app.route('/page/<int:page>')
def pagination(page):
	perpage = 5
	start = (page - 1) * 5

	cur = g.db.execute('select title, id, content, create_time from entries order by create_time desc limit 5 offset ?', (start,))
	entries = [dict(title=row['title'], id=row['id'], content=markdown(row['content']), date=row['create_time']) for row in cur.fetchall()]

	cur = g.db.execute('select * from entries')
	total = len(cur.fetchall())

	page = page

	return render_template('index.html', **locals())


@app.route('/new', methods=['GET', 'POST'])
def new_draft():
	if request.method == 'POST':
		title = request.form['title']
		slug = slugify(title)
		content = request.form['content']
		date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

		g.db.execute('insert into entries (title, content, create_time, slug, status) values (?, ?, ?, ?, "draft")',
								 [title, content, date, slug], )
		g.db.commit()

		filepath = os.path.join(app.config['DRAFT_FOLDER'], slug + '.md')
		newfile = open(unicode(filepath, 'utf8'), 'w')

		#meta =  yaml.safe_dump({
		#	'title': title,
		#	'date': date,
		#	'tags': [''],
		#	'categories': ['']
		#}, default_flow_style=False).replace('- ', '  - ')
		newfile.write('title: \"' + title + '\"\n')
		newfile.write('date: ' + date + '\n')
		#newfile.write(meta + '\n')

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

@app.route('/unpublish', methods=['POST'])
def unpublish():
	if request.method == 'POST':
		title = request.form['title']
		slug = slugify(title)

		cur = g.db.execute('update entries set status=? where slug=?', ("draft", slug))
		g.db.commit()

		publish_file = os.path.join(app.config['POST_FOLDER'], slug + '.md')
		draft_file = os.path.join(app.config['DRAFT_FOLDER'], slug + '.md')

		os.rename(publish_file, draft_file)

		return jsonify(r=True)


@app.route('/posts/<int:id>')
def show_entry(id):
	cur = g.db.execute('select title, content, create_time from entries where id=?', (id,))
	_entry = cur.fetchone()

	entry = dict(title=_entry['title'], content=markdown(_entry['content']), date=_entry['create_time'], id=id)

	return render_template('entry.html', **locals())


@app.route('/posts/<int:id>/edit')
def edit_entry(id):
	cur = g.db.execute('select title, content, slug, status from entries where id=?', (id,))
	_entry = cur.fetchone()
	post_title = _entry['title']
	post_content = _entry['content']
	slug = _entry['slug']
	status = _entry['status']

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


# TODO
@app.route('/rss.xml')
def feed():
	cur = db.execute('select title, content, slug, create_time from entries order by create_time desc limit 20')

	for row in cur.fetchall():
		title = row['title']
		content = row['content']
		slug = row['slug']
		create_time = row['create_time']

	pass


# generate index
def build_index():
	lookup = TemplateLookup(directories=['./templates'])
	template = Template(filename='./templates/index.html', lookup=lookup)

	with closing(connect_db()) as db:
		cur = db.execute('select title, content, status, create_time, id, slug from entries order by create_time desc limit 5')

		entries = []

		for row in cur.fetchall():
			status = row['status']
			title = row['title']
			date = row['create_time']
			id = row['slug']
			_content = row['content'].split('<!--more-->')[0]
			content = markdown(_content)

			if status != 'draft':
				entry = dict(title=title, content=content, date=date, id=id)
				entries.append(entry)

		cur = db.execute('select * from entries')
		total = len(cur.fetchall())
		html_content = template.render(entries=entries, total=total, page=1, perpage=5)

		dist = os.path.join(app.config['GHPAGES'], 'index.html')

		with codecs.open(dist, 'w', 'utf-8-sig') as f:
			f.write(html_content)


def build_pages():
	with closing(connect_db()) as db:
		cur = g.db.execute('select * from entries')
		length = len(cur.fetchall())

		for page in range(1, int(math.ceil(length / float(5))) + 1):
			print page
			start = (page - 1) * 5

			cur = g.db.execute('select title, slug, content, status, create_time, id, slug from entries order by create_time desc limit 5 offset ?',
												 (start,))
			entries = []

			for row in cur.fetchall():
				status = row['status']
				title = row['title']
				id = row['slug']
				date = row['create_time']
				_content = row['content'].split('<!--more-->')[0]
				content = markdown(_content)

				if status != 'draft':
					entry = dict(title=title, id=id, content=content, date=date)
					entries.append(entry)

			lookup = TemplateLookup(directories=['./templates'])
			template = Template(filename='./templates/index.html', lookup=lookup)
			html_content = template.render(entries=entries, total=length, page=page, perpage=5)

			page_path = os.path.join(app.config['PAGES'], str(page))

			try:
				os.mkdir(page_path)
			except OSError:
				pass

			dist = os.path.join(page_path, 'index.html')

			with codecs.open(dist, 'w', 'utf-8-sig') as f:
				f.write(html_content)

			page += 1


def build_posts():
	with closing(connect_db()) as db:
		cur = g.db.execute('select title, content, slug, status, create_time from entries')

		for _entry in cur.fetchall():
			status = _entry['status']

			if status != 'draft':
				post_title = _entry['title']
				post_content = markdown(_entry['content'])
				post_slug = _entry['slug']
				date = _entry['create_time']

				lookup = TemplateLookup(directories=['./templates'])
				template = Template(filename='./templates/entry.html', lookup=lookup)

				entry = dict(title=post_title, content=post_content, date=date, id=_entry['slug'])

				html_content = template.render(entry=entry)

				os.mkdir(os.path.join(app.config['POSTS'], post_slug))

				dist = os.path.join(app.config['POSTS'], post_slug + '/index.html')

				with codecs.open(dist, 'w', 'utf-8-sig') as f:
					f.write(html_content)


# TODO
def build_archive():
	pass

# TODO
def build_tag():
	# select * from entries where tag like '%mindfire%'
	pass


@app.route('/build', methods=['POST', 'GET'])
def build():
	if request.method == 'POST':
		shutil.rmtree(app.config['GHPAGES'])
		os.mkdir(app.config['GHPAGES'])
		os.mkdir(app.config['PAGES'])
		os.mkdir(app.config['POSTS'])

		# build static files
		shutil.copytree(app.config['SRC_STATIC'], app.config['STATIC'])
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
