# -*- coding: utf-8 -*-

from flask import Blueprint
from flask.ext.mako import render_template

from summer.model.entry import Entry

bp = Blueprint('home', __name__)

@bp.route('/')
def show_entries():
    page = 1
    perpage = 5

    entries = Entry.get_page(page)
    total = Entry.get_length()

    return render_template('index.html', **locals())
