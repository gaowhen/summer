# -*- coding: utf-8 -*-

import sys
# FIXME correct encodings and remove this hack
reload(sys).setdefaultencoding('utf-8')

from flask import Flask, g
from flask.ext.mako import MakoTemplates
from werkzeug.utils import import_string

blueprints = [
    'summer.view.home:bp',
    'summer.view.page.page:bp',
    'summer.view.post.post:bp',
    'summer.view.admin.admin:bp',
    'summer.view.build.build:bp',
    'summer.view.deploy.deploy:bp',
]


def create_app():
    app = Flask(__name__)
    app.config.from_pyfile('app.cfg')

    MakoTemplates(app)

    for blueprint_qualname in blueprints:
        blueprint = import_string(blueprint_qualname)
        app.register_blueprint(blueprint)

    @app.before_request
    def before_request():
        g.debug = True

    @app.teardown_appcontext
    def teardown_db(exception):
        db = getattr(g, '_database', None)
        if db is not None:
            db.close()

    return app
