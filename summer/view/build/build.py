# -*- coding: utf-8 -*-

import os
import datetime

from flask import Blueprint, g, request, jsonify
from flask.ext.misaka import markdown
from flask.ext.mako import render_template
from slugify import slugify
from contextlib import closing

import codecs
import shutil
import math
from mako.template import Template
from mako.lookup import TemplateLookup

from feedgen.feed import FeedGenerator

from summer.db.connect import connect_db

bp = Blueprint('build', __name__)


def build_index():
	lookup = TemplateLookup(directories=['./summer/templates'])
	template = Template(filename='./summer/templates/index.html', lookup=lookup)

	with closing(connect_db()) as db:
		cur = db.execute('select title, content, status, create_time, id, slug from entries where status is not ? order by create_time desc limit 5', ('draft',))

		entries = []

		for row in cur.fetchall():
			status = row['status']
			title = row['title']
			date = row['create_time']
			id = row['slug']
			status = row['status']
			_content = row['content'].split('<!--more-->')[0]
			content = markdown(_content)

			entry = dict(title=title, content=content, date=date, id=id, status=status)
			entries.append(entry)

	  # TODO
	  # filter posts are not draft
		cur = db.execute('select * from entries where status is not ?', ('draft',))
		total = len(cur.fetchall())
		print total

		html_content = template.render(entries=entries, total=total, page=1, perpage=5)

		dist = os.path.join('./ghpages/', 'index.html')

		with codecs.open(dist, 'w', 'utf-8-sig') as f:
			f.write(html_content)


def build_pages():
	with closing(connect_db()) as db:
		cur = db.execute('select * from entries where status is not ?', ('draft',))
		length = len(cur.fetchall())

		for page in range(1, int(math.ceil(length / float(5))) + 1):
			# print page
			start = (page - 1) * 5

			cur = g.db.execute('select title, slug, content, status, create_time, id, slug from entries where status is not ? order by create_time desc limit 5 offset ?',
												 ('draft', start,))
			entries = []

			for row in cur.fetchall():
				status = row['status']
				title = row['title']
				id = row['slug']
				date = row['create_time']
				status = row['status']
				_content = row['content'].split('<!--more-->')[0]
				content = markdown(_content)

				if status != 'draft':
					entry = dict(title=title, id=id, content=content, date=date, status=status)
					entries.append(entry)

			lookup = TemplateLookup(directories=['./summer/templates'])
			template = Template(filename='./summer/templates/index.html', lookup=lookup)
			html_content = template.render(entries=entries, total=length, page=page, perpage=5)

			page_path = os.path.join('./ghpages/page', str(page))

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

				lookup = TemplateLookup(directories=['./summer/templates'])
				template = Template(filename='./summer/templates/entry.html', lookup=lookup)

				entry = dict(title=post_title, content=post_content, date=date, id=_entry['slug'], status=status)

				html_content = template.render(entry=entry)

				os.mkdir(os.path.join('./ghpages/posts', post_slug))

				dist = os.path.join('./ghpages/posts', post_slug + '/index.html')

				with codecs.open(dist, 'w', 'utf-8-sig') as f:
					f.write(html_content)


# TODO
def build_archive():
	pass


# TODO
def build_tag():
	# select * from entries where tag like '%mindfire%'
	pass


def build_feed():
	fg = FeedGenerator()

	fg.id('http://gaowhen.com')
	fg.title(u'Gaowhen高H温')
	fg.author({'name': u'Miko Gao/糖伴西红柿', 'email': 'gaowhen.com@gmail.com'})
	fg.link(href='http://gaowhen.com', rel='alternate')
	fg.subtitle(u'「文不能测字 武不能防身」')
	fg.link(href='http://gaowhen.com/rss.xml', rel='self')
	#fg.lastBuildDate(datetime.datetime.now())
	#fg.pubDate(datetime.datetime.now())
	fg.language('zh')

	with closing(connect_db()) as db:
		cur = g.db.execute('select title, content, slug, create_time from entries where status is not ? order by create_time desc', ('draft',))

		for _entry in cur.fetchall():
			fe = fg.add_entry()
			fe.id('http://gaowhen.com/' + _entry['slug'] + '/')
			fe.title(_entry['title'])
			fe.description(markdown(_entry['content']))
			#fe.pubdate(_entry['create_time'])
			fe.link(href='http://gaowhen.com/' + _entry['slug'] + '/')
			fe.guid('http://gaowhen.com/' + _entry['slug'] + '/')

	rssfeed  = fg.rss_str(pretty=True)
	fg.rss_file(os.path.join('./ghpages/', 'rss.xml'))


@bp.route('/build', methods=['POST',])
def build():
	if request.method == 'POST':
		shutil.rmtree('./ghpages/page')
		shutil.rmtree('./ghpages/posts')
		shutil.rmtree('./ghpages/static')
		# os.mkdir('./ghpages')
		os.mkdir('./ghpages/page')
		os.mkdir('./ghpages/posts')

		# copy static files
		shutil.copytree('./summer/static', './ghpages/static')

		# copy source files
		# shutil.copytree('./fe/source', './ghpages/')

		# index
		build_index()

		# page
		build_pages()

		# post
		build_posts()

		# TODO
		# archive

		# TODO
		# feed
		build_feed()

		return jsonify(r=True)
