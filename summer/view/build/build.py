# -*- coding: utf-8 -*-

import os
import datetime

from flask import Blueprint, request, jsonify
from flask.ext.misaka import markdown
from werkzeug.contrib.atom import AtomFeed

import codecs
import shutil
import math
from mako.template import Template
from mako.lookup import TemplateLookup

from summer.model.entry import Entry

bp = Blueprint('build', __name__)


def build_index():
	lookup = TemplateLookup(directories=['./summer/templates'])
	template = Template(filename='./summer/templates/index.html', lookup=lookup)

	page = 1
	perpage = 5
	entries = Entry.get_published_page(page)

	total = len(Entry.get_all_published())

	html_content = template.render(entries=entries, total=total, page=1, perpage=5)

	dist = os.path.join('./ghpages/', 'index.html')

	with codecs.open(dist, 'w', 'utf-8-sig') as f:
		f.write(html_content)


def build_pages():
	lookup = TemplateLookup(directories=['./summer/templates'])
	template = Template(filename='./summer/templates/index.html', lookup=lookup)

	length = len(Entry.get_all_published())

	for page in range(1, int(math.ceil(length / float(5))) + 1):
		entries = Entry.get_published_page(page)
		html_content = template.render(entries=entries, total=length, page=page, perpage=5)

		page_path = os.path.join('./ghpages/page', str(page))

		try:
			os.mkdir(page_path)
		except OSError:
			pass

		dist = os.path.join(page_path, 'index.html')

		with codecs.open(dist, 'w', 'utf-8-sig') as f:
			f.write(html_content)


def build_posts():
	lookup = TemplateLookup(directories=['./summer/templates'])
	template = Template(filename='./summer/templates/entry.html', lookup=lookup)

	entries = Entry.get_all_published()

	for _entry in entries:
		post_title = _entry['title']
		post_content = markdown(_entry['content'])
		post_slug = _entry['slug']
		date = _entry['date']
		status = _entry['status']

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
	feed = AtomFeed(u'Gaowhen高H温',
		feed_url='http://gaowhen.com/rss.xml',
		url='http://gaowhen.com',
		subtitle='「文不能测字 武不能防身」',
		author=u'Miko Gao aka 糖伴西红柿',
		updated=datetime.datetime.now())

	entries = Entry.get_all_published()

	for _entry in entries:
		time = datetime.datetime.strptime(_entry['date'], '%Y-%m-%d %H:%M:%S')

		feed.add(unicode(_entry['title']),
			unicode(markdown(_entry['content'])),
			content_type='html',
			author=u'Miko Gao aka 糖伴西红柿',
			published=time,
			updated=time,
			id='http://gaowhen.com/' + _entry['slug'] + '/',
			url='http://gaowhen.com/' + _entry['slug'] + '/'
		)

	with codecs.open('./ghpages/rss.xml', 'w', 'utf-8-sig') as f:
		f.write(feed.to_string())


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
