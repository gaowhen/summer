# -*- coding: utf-8 -*-

import sys
# FIXME correct encodings and remove this hack
reload(sys).setdefaultencoding('utf-8')

from flask import Flask, g
from flask.ext.mako import MakoTemplates
from werkzeug.utils import import_string

from summer.db.connect import connect_db

blueprints = [
	#'summer.middleware.db:bp',
	'summer.view.home:bp',
  'summer.view.page.page:bp',
	'summer.view.post.post:bp',
	'summer.view.admin.admin:bp',
	'summer.view.build.build:bp',
]

def create_app():
	app = Flask(__name__)
	app.config.from_pyfile('app.cfg')

	mako = MakoTemplates(app)

	for blueprint_qualname in blueprints:
		blueprint = import_string(blueprint_qualname)
		app.register_blueprint(blueprint)


	@app.before_request
	def before_request():
		g.db = connect_db()
		g.debug = True


	@app.teardown_request
	def teardown_request(exception):
		db = getattr(g, 'db', None)
		if db is not None:
			db.close()


	return app
