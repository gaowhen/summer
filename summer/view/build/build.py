# -*- coding: utf-8 -*-

import os
import datetime
import subprocess

from flask import Blueprint, jsonify, current_app
from flask.ext.misaka import markdown
from werkzeug.contrib.atom import AtomFeed

import codecs
import shutil
import math
from mako.template import Template
from mako.lookup import TemplateLookup

from summer.model.entry import Entry

bp = Blueprint('build', __name__)

BASE_DIR = './ghpages'
PAGE_DIR = BASE_DIR + '/page'
POSTS_DIR = BASE_DIR + '/posts'
TEMPLATE_DIR = './fe/template'
STATIC_DIR = BASE_DIR + '/static'


def build_index():
    lookup = TemplateLookup(directories=[TEMPLATE_DIR])
    template = Template(
        filename=TEMPLATE_DIR + '/index.html', lookup=lookup)

    page = 1
    perpage = 5
    entries = Entry.get_published_page(page)

    total = len(Entry.get_all_published())

    html_content = template.render(
        entries=entries, total=total, page=page, perpage=perpage)

    dist = os.path.join(BASE_DIR, 'index.html')

    with codecs.open(dist, 'w', 'utf-8-sig') as f:
        f.write(html_content)


def build_pages():
    lookup = TemplateLookup(directories=[TEMPLATE_DIR])
    template = Template(
        filename=TEMPLATE_DIR + '/index.html', lookup=lookup)

    all_entries = Entry.get_all_published(True)
    length = len(all_entries)

    for page in range(1, int(math.ceil(length / float(5))) + 1):
        start = (page - 1) * 5
        end = start + 5

        entries = all_entries[start:end]

        html_content = template.render(
            entries=entries, total=length, page=page, perpage=5)

        page_path = os.path.join(PAGE_DIR, str(page))

        try:
            os.mkdir(page_path)
        except OSError:
            pass

        dist = os.path.join(page_path, 'index.html')

        with codecs.open(dist, 'w', 'utf-8-sig') as f:
            f.write(html_content)


def build_posts():
    lookup = TemplateLookup(directories=[TEMPLATE_DIR])
    template = Template(
        filename=TEMPLATE_DIR + '/entry.html', lookup=lookup)

    entries = Entry.get_all_published()

    for _entry in entries:
        post_title = _entry['title']
        post_content = markdown(_entry['content'])
        post_slug = _entry['slug']
        date = _entry['date']
        status = _entry['status']

        entry = dict(
            title=post_title,
            content=post_content,
            date=date,
            id=_entry['slug'],
            status=status
        )

        html_content = template.render(entry=entry)

        os.mkdir(os.path.join(POSTS_DIR, post_slug))

        dist = os.path.join(POSTS_DIR, post_slug + '/index.html')

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
    feed = AtomFeed(current_app.config['SITE_NAME'],
                    feed_url=current_app.config['DOMAIN'] + 'rss.xml',
                    url=current_app.config['DOMAIN'],
                    subtitle=current_app.config['SUBTITLE'],
                    author=current_app.config['AUTHOR'],
                    updated=datetime.datetime.now())

    entries = Entry.get_all_published()

    for _entry in entries:
        time = datetime.datetime.strptime(_entry['date'], '%Y-%m-%d %H:%M:%S')

        feed.add(unicode(_entry['title']),
                 unicode(markdown(_entry['content'])),
                 content_type='html',
                 author=current_app.config['AUTHOR'],
                 published=time,
                 updated=time,
                 id=current_app.config['DOMAIN'] + _entry['slug'] + '/',
                 url=current_app.config['DOMAIN'] + 'posts/' + _entry['slug'] + '/'
                 )

    with codecs.open(BASE_DIR + '/rss.xml', 'w', 'utf-8-sig') as f:
        f.write(feed.to_string())


@bp.route('/build', methods=['POST'])
def build():
    if os.path.exists(PAGE_DIR):
        shutil.rmtree(PAGE_DIR)
    os.mkdir(PAGE_DIR)

    if os.path.exists(POSTS_DIR):
        shutil.rmtree(POSTS_DIR)
    os.mkdir(POSTS_DIR)

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

    # feed
    build_feed()

    # TODO
    # site map

    if os.path.exists(STATIC_DIR):
        shutil.rmtree(STATIC_DIR)
    subprocess.call(['gulp', 'release'])

    return jsonify(r=True)
