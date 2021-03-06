# -*- coding: utf-8 -*-

import os
import base64

from flask import Blueprint, request, jsonify
from flask.ext.mako import render_template
from werkzeug import secure_filename

bp = Blueprint('admin', __name__)


@bp.route('/upload', methods=['POST', ])
def upload():
    _file = request.files['file']

    if _file:
        filename = secure_filename(_file.filename)
        _file.save(os.path.join('./fe/static/img', filename))

        # data = base64.b64encode(_file.read())

        return jsonify(
                r=True,
                path='/static/img/' + filename,
                # data=data,
            )

    return jsonify(r=False)


@bp.route('/new')
def new_draft():
    return render_template('new.html', **locals())
