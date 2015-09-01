# -*- coding: utf-8 -*-

from flask.ext.script import Manager
from summer.app import create_app

app = create_app('product')

manager = Manager(app)

@manager.command
def web():
    app.run()

if __name__ == "__main__":
    manager.run()
