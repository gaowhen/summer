# -*- coding: utf-8 -*-

import sys

reload(sys).setdefaultencoding('utf-8')

from summer.app import create_app

app = create_app()

if __name__ == '__main__':
	app.run()