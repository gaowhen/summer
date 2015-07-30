# -*- coding: utf-8 -*-

from flask import Blueprint
from flask.ext.mako import render_template

from summer.model.entry import Entry

bp = Blueprint('page', __name__, url_prefix='/page')

@bp.route('/<int:page>')
def pagination(page):
    perpage = 5
    entries = Entry.get_page(page)
    total = Entry.get_length()

    return render_template('index.html', **locals())
