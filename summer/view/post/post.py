# -*- coding: utf-8 -*-

import os

from flask import Blueprint, g, request, jsonify
from flask.ext.mako import render_template
from flask.ext.misaka import markdown
from slugify import slugify


bp = Blueprint('post', __name__, url_prefix='/posts')

@bp.route('/<int:id>')
def show_entry(id):
	cur = g.db.execute('select title, content, create_time from entries where id=?', (id,))
	_entry = cur.fetchone()

	entry = dict(title=_entry['title'], content=markdown(_entry['content']), date=_entry['create_time'], id=id)

	return render_template('entry.html', **locals())


@bp.route('/<int:id>/edit')
def edit_entry(id):
	cur = g.db.execute('select title, content, slug, status from entries where id=?', (id,))
	_entry = cur.fetchone()
	post_title = _entry['title']
	post_content = _entry['content']
	slug = _entry['slug']
	status = _entry['status']

	return render_template('edit.html', **locals())


@bp.route('/<int:id>/update', methods=['POST'])
def update_entry(id):
	if request.method == 'POST':
		cur = g.db.execute('select slug, create_time, status from entries where id=?', (id,))
		_entry = cur.fetchone()
		name = _entry['slug']
		create_time = _entry['create_time']
		status = _entry['status']

		title = request.form['title']
		content = request.form['content']
		cur = g.db.execute('update entries set title=?, content=? where id=?', (title, content, id))
		g.db.commit()

		if status == 'draft':
			# delete old file
			os.remove(os.path.join('./summer/_draft/', name + '.md'))

			# create new file
			filepath = os.path.join('./summer/_draft/', name + '.md')
		else:
			# delete old file
			os.remove(os.path.join('./summer/post/', name + '.md'))

			# create new file
			filepath = os.path.join('./summer/post/', name + '.md')

		newfile = open(unicode(filepath, 'utf8'), 'w')

		newfile.write('title: \"' + title.encode('utf8') + '\"\n')
		newfile.write('date: ' + create_time + '\n')
		newfile.write('---' + '\n\n')
		newfile.write(content.encode('utf8'))
		newfile.write('\n')
		newfile.close()

		return jsonify(r=True)

	return redirect('/')


@bp.route('/<int:id>/del', methods=['POST'])
def delete_entry(id):
	if request.method == 'POST':
		cur = g.db.execute('select slug, status from entries where id=?', (id,))
		_entry = cur.fetchone()
		name = _entry['slug']
		status = _entry['status']

		cur = g.db.execute('delete from entries where id=?', (id,))
		g.db.commit()

		if status == 'draft':
			os.remove(os.path.join('./summer/_draft/', name + '.md'))
		else:
			os.remove(os.path.join('./summer/post/', name + '.md'))

		return jsonify(r=True)

	return redirect('/')