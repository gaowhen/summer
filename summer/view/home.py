# -*- coding: utf-8 -*-

from flask import Blueprint, g
from flask.ext.mako import render_template
from flask.ext.misaka import markdown

bp = Blueprint('home', __name__)

@bp.route('/')
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