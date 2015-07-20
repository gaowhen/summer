var gulp = require('gulp')
var config = require('config').gulp
var watch = require('gulp-watch')
var watchify = require('./watchify')
var image = require('./image')
var stylus = require('./stylus')
var html = require('./html')
var basejs = require('./base-js')

gulp.task('watch', ['base-js', 'image', 'watchify', 'stylus', 'html'], function () {
	watch(config.src.js + '/**/*.js', function () {
		gulp.start('watchify')
	})

	watch(config.src.img + '/**/*.+(png|gif|jpg|eot|woff|ttf|svg|ico)', function () {
		gulp.start('image')
	})

	watch(config.src.css + '/**/*.styl', function () {
		gulp.start('stylus')
	})

	watch(config.src.template + '/**/*.html', function () {
		gulp.start('html')
	})

})
