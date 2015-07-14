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


@bp.route('/new', methods=['GET', 'POST'])
def new_draft():
	if request.method == 'POST':
		title = request.form['title']
		slug = slugify(title)
		content = request.form['content']
		date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

		g.db.execute('insert into entries (title, content, create_time, slug, status) values (?, ?, ?, ?, "draft")',
								 [title, content, date, slug], )
		g.db.commit()

		filepath = os.path.join('./summer/_draft/', slug + '.md')
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


@bp.route('/publish', methods=['POST'])
def publish_draft():
	if request.method == 'POST':
		title = request.form['title']
		slug = slugify(title)

		cur = g.db.execute('update entries set status=? where slug=?', ("publish", slug))
		g.db.commit()

		draft_file = os.path.join('./summer/_draft/', slug + '.md')
		publish_file = os.path.join('./summer/post/', slug + '.md')

		os.rename(draft_file, publish_file)

		return jsonify(r=True)

@bp.route('/unpublish', methods=['POST'])
def unpublish():
	if request.method == 'POST':
		title = request.form['title']
		slug = slugify(title)

		cur = g.db.execute('update entries set status=? where slug=?', ("draft", slug))
		g.db.commit()

		publish_file = os.path.join('./summer/post/', slug + '.md')
		draft_file = os.path.join('./summer/_draft/', slug + '.md')

		os.rename(publish_file, draft_file)

		return jsonify(r=True)

