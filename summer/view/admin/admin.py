# -*- coding: utf-8 -*-

import os

from flask import Blueprint, g, request, jsonify
from flask.ext.mako import render_template
from flask.ext.misaka import markdown
from slugify import slugify
import yaml

from werkzeug import secure_filename
from datetime import datetime

bp = Blueprint('admin', __name__)

@bp.route('/upload', methods=['POST', ])
def upload():
	if request.method == 'POST':
		_file = request.files['file']

		if _file:
			filename = secure_filename(_file.filename)
			_file.save(os.path.join('./summer/static/src/img', filename))
			return jsonify(r=True, path='/static/img/' + filename)

		return jsonify(r=False)

	return jsonify(r=False)


@bp.route('/new', methods=['GET',])
def new_draft():
	return render_template('new.html', **locals())


@bp.route('/save', methods=['POST'])
def save():
	id = request.form['id']

	if id == '-1':
		title = request.form['title']
		slug = slugify(title)
		content = request.form['content']
		date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

		g.db.execute('insert into entries (title, content, create_time, slug, status) values (?, ?, ?, ?, "draft")',
								 [title, content, date, slug], )
		g.db.commit()

		filepath = os.path.join('./summer/_draft/', slug + '.md')
		newfile = open(unicode(filepath, 'utf8'), 'w')

		meta =  yaml.safe_dump({
			'title': title,
			'date': date,
			'tags': [''],
			'categories': ['']
		}, default_flow_style=False).replace('- ', '  - ')

		newfile.write(meta + '\n')
		newfile.write('---' + '\n\n')
		newfile.write(content.encode('utf8'))
		newfile.write('\n')
		newfile.close()

		cur = g.db.execute('select id, status from entries where slug=?', (slug,))

		entry = cur.fetchone()

		id = entry['id']
		status = entry['status']

		return jsonify(r=True, id=id, status=status)
	else:
		title = request.form['title']
		content = request.form['content']

		cur = g.db.execute('update entries set title=?, content=? where id=?', (title, content, id))
		g.db.commit()

		cur = g.db.execute('select slug, create_time, status from entries where id=?', (id,))

		_entry = cur.fetchone()

		name = _entry['slug']
		date = _entry['create_time']
		status = _entry['status']

		if status == 'draft':
			filename = os.path.join('./summer/_draft/', name + '.md')
		else:
			filename = os.path.join('./summer/post/', name + '.md')

		open(filename, 'w').close()

		newfile = open(filename, 'w')

		meta =  yaml.safe_dump({
			'title': title.encode('utf8'),
			'date': date,
			'tags': [''],
			'categories': ['']
		}, default_flow_style=False).replace('- ', '  - ')

		newfile.write(meta + '\n')
		newfile.write('---' + '\n\n')
		newfile.write(content.encode('utf8'))
		newfile.write('\n')
		newfile.close()

		return jsonify(r=True, id=id, status=status)


@bp.route('/publish', methods=['POST'])
def publish_draft():
	id = request.form['id']

	cur = g.db.execute('update entries set status=? where id=?', ('publish', id))
	g.db.commit()

	cur = g.db.execute('select slug from entries where id=?', (id,))

	entry = cur.fetchone()

	slug = entry['slug']

	draft_file = os.path.join('./summer/_draft/', slug + '.md')
	post_file = os.path.join('./summer/post/', slug + '.md')

	os.rename(draft_file, post_file)

	return jsonify(r=True)


@bp.route('/unpublish', methods=['POST'])
def unpublish():
	id = request.form['id']

	cur = g.db.execute('update entries set status=? where id=?', ('draft', id))
	g.db.commit()

	cur = g.db.execute('select slug from entries where id=?', (id,))

	entry = cur.fetchone()

	filename = entry['slug']
	print filename

	post_file = os.path.join('./summer/post/', filename + '.md')
	draft_file = os.path.join('./summer/_draft/', filename + '.md')

	os.rename(post_file, draft_file)

	return jsonify(r=True)

