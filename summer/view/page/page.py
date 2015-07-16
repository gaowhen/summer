# -*- coding: utf-8 -*-

from flask import Blueprint, g
from flask.ext.mako import render_template
from flask.ext.misaka import markdown

bp = Blueprint('page', __name__, url_prefix='/page')

@bp.route('/<int:page>')
def pagination(page):
	perpage = 5
	start = (page - 1) * 5

	cur = g.db.execute('select title, id, content, create_time, status from entries order by create_time desc limit 5 offset ?', (start,))
	entries = [dict(title=row['title'], id=row['id'], content=markdown(row['content']), date=row['create_time'], status=row['status']) for row in cur.fetchall()]

	cur = g.db.execute('select * from entries')
	total = len(cur.fetchall())

	page = page

	return render_template('index.html', **locals())

