# -*- coding: utf-8 -*-

import os

from flask import Blueprint, request, jsonify
from flask.ext.mako import render_template
from werkzeug import secure_filename

from summer.model.entry import Entry

bp = Blueprint('admin', __name__)


@bp.route('/upload', methods=['POST', ])
def upload():
	if request.method == 'POST':
		_file = request.files['file']

		if _file:
			filename = secure_filename(_file.filename)
			_file.save(os.path.join('./fe/static/img', filename))
			return jsonify(r=True, path='/static/img/' + filename)

		return jsonify(r=False)

	return jsonify(r=False)


@bp.route('/new', methods=['GET',])
def new_draft():
	return render_template('new.html', **locals())

