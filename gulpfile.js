var gulp = require('gulp');
var requireDir = require('require-dir');

global.REGEX = /\{\{\{(\S*?)\}\}\}/g
global.REG_BUILD = '/$1'
global.MANIFEST =  __dirname + '/fe/static/rev-manifest.json'

requireDir('./fe/gulp', {recurse: true});