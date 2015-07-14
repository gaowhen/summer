from flask import g, Blueprint
from summer.db.connect import connect_db

bp = Blueprint('db', __name__)

@bp.before_request
def before_request():
	g.db = connect_db()
	g.debug = True


@bp.teardown_request
def teardown_request(exception):
	db = getattr(g, 'db', None)
	if db is not None:
		db.close()