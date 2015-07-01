var path = require('path');

var src = {
  path: path.resolve(__dirname, '../static/src'),
  js: path.resolve(__dirname, '../static/src/js'),
  css: path.resolve(__dirname, '../static/src/css'),
  img: path.resolve(__dirname, '../static/src/img')
};

var dist = {
  path: path.resolve(__dirname, '../static'),
  js: path.resolve(__dirname, '../static/js'),
  css: path.resolve(__dirname, '../static/css'),
  img: path.resolve(__dirname, '../static/img')
};

var config = {
  src: src,
  dist: dist
};

module.exports = config;