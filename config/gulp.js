var path = require('path')

var src = {
  path: path.resolve(__dirname, '../fe/static/src'),
  js: path.resolve(__dirname, '../fe/static/js'),
  css: path.resolve(__dirname, '../fe/static/css'),
  img: path.resolve(__dirname, '../fe/static/img'),
	template: path.resolve(__dirname, '../fe/template')
}

var dist = {
  path: path.resolve(__dirname, '../summer/static'),
  js: path.resolve(__dirname, '../summer/static/js'),
  css: path.resolve(__dirname, '../summer/static/css'),
  img: path.resolve(__dirname, '../summer/static/img'),
	template: path.resolve(__dirname, '../summer/templates')
}

var release = {
	path: path.resolve(__dirname, '../ghpages/static'),
	js: path.resolve(__dirname, '../ghpages/static/js'),
	css: path.resolve(__dirname, '../ghpages/static/css'),
	img: path.resolve(__dirname, '../ghpages/static/img')
}

var config = {
  src: src,
  dist: dist
}

module.exports = config