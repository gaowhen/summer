# -*- coding: utf-8 -*-

#  all the imports
import sqlite3
from flask import Flask, request, g, redirect, render_template, jsonify
from contextlib import closing
from flask.ext.mako import MakoTemplates, render_template
import glob
import errno
import yaml
import os
import ntpath
from flask.ext.misaka import markdown
from slugify import slugify
from werkzeug import secure_filename

app = Flask(__name__)
app.config.from_pyfile('app.cfg')
# app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
# app.config['POST_FOLDER'] = POST_FOLDER

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
		file = request.files['file']

		if file:
			filename = secure_filename(file.filename)
			file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
			return jsonify(r=True, path='/static/src/img/' + filename)

		return jsonify(r=False)

	return redirect('/')


@app.route('/')
def show_entries():
	cur = g.db.execute('select title, slug, content from entries order by create_time desc limit 5')
	entries = [dict(title=row['title'], slug=row['slug'], content=markdown(row['content'])) for row in cur.fetchall()]

	return render_template('index.html', **locals())


@app.route('/page/<int:page>')
def pagination(page):
	start = (page - 1) * 5

	cur = g.db.execute('select title, slug, content from entries order by create_time desc limit 5 offset ?', (start,))
	entries = [dict(title=row['title'], slug=row['slug'], content=markdown(row['content'])) for row in cur.fetchall()]

	return render_template('index.html', **locals())


@app.route('/add', methods=['GET', 'POST'])
def add_entry():
	if request.method == 'POST':
		title = request.form['title']
		slug = slugify(title)
		content = request.form['content']
		date = request.form['date']

		g.db.execute('insert into entries (title, content, create_time, slug) values (?, ?, ?, ?)',
								 [title, content, date, slug], )
		g.db.commit()

		filepath = os.path.join(app.config['POST_FOLDER'], slug + '.md')
		newfile = open(unicode(filepath, 'utf8'), 'w')

		newfile.write('title: \"' + title + '\"\n')
		newfile.write('date: ' + date + '\n')
		newfile.write('---' + '\n\n')
		newfile.write(content.encode('utf8'))
		newfile.write('\n')
		newfile.close()

		return jsonify(r=True)

	return render_template('add.html', **locals())


@app.route('/post/<string:name>')
def show_entry(name):
	cur = g.db.execute('select title, content from entries where slug=?', (name,))
	_entry = cur.fetchone()
	post_title = _entry['title']
	post_content = markdown(_entry['content'])
	return render_template('entry.html', **locals())


@app.route('/post/<string:name>/edit')
def edit_entry(name):
	cur = g.db.execute('select title, content from entries where slug=?', (name,))
	_entry = cur.fetchone()
	post_title = _entry['title']
	post_content = _entry['content']
	slug = name
	return render_template('edit.html', **locals())


@app.route('/post/<string:name>/update', methods=['POST'])
def update_entry(name):
	if request.method == 'POST':
		title = request.form['title']
		slug = slugify(title)
		content = request.form['content']
		cur = g.db.execute('update entries set title=?, slug=?, content=? where slug=?', (title, slug, content, name))
		g.db.commit()

		# delete old file
		os.remove(os.path.join(app.config['POST_FOLDER'], name + '.md'))

		filepath = os.path.join(app.config['POST_FOLDER'], slug + '.md')
		newfile = open(unicode(filepath, 'utf8'), 'w')

		newfile.write('title: \"' + title.encode('utf8') + '\"\n')
		# TODO
		# save date
		# newfile.write('date: ' + date + '\n')
		newfile.write('---' + '\n\n')
		newfile.write(content.encode('utf8'))
		newfile.write('\n')
		newfile.close()

		return jsonify(r=True)

	return redirect('/')


@app.route('/post/<string:name>/del', methods=['POST'])
def delete_entry(name):
	if request.method == 'POST':
		cur = g.db.execute('delete from entries where slug=?', (name,))
		g.db.commit()

		os.remove(os.path.join(app.config['POST_FOLDER'], name + '.md'))

		return jsonify(r=True)

	return redirect('/')


if __name__ == '__main__':
	app.run()
